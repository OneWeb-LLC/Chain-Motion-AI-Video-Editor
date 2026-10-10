"""Switch the HTTP listener without restarting generation workers."""
import asyncio
import ipaddress
import json
from pathlib import Path


def is_local(host):
    try:
        address = ipaddress.ip_address(host)
        return address.is_loopback or bool(getattr(address, 'ipv4_mapped', None) and address.ipv4_mapped.is_loopback)
    except ValueError:
        return False


def saved_lan(root):
    try:
        return json.loads((Path(root) / 'hosting.json').read_text()).get('lan') is True
    except (OSError, ValueError, AttributeError):
        return False


class Hosting:
    def __init__(self, server, root, addresses):
        self.server = server
        self.root = Path(root)
        self.addresses = addresses
        self.host = server.config.host
        self.lock = asyncio.Lock()

    @property
    def lan(self):
        return not is_local(self.host)

    def status(self):
        port = self.server.config.port
        return dict(supported=True, lan=self.lan, local_url=f'http://127.0.0.1:{port}',
                    urls=[f'http://{a}:{port}' for a in self.addresses()] if self.lan else [])

    async def bind(self, host):
        config = self.server.config
        return await asyncio.get_running_loop().create_server(
            lambda: config.http_protocol_class(config=config, server_state=self.server.server_state,
                                               app_state=self.server.lifespan.state),
            host=host, port=config.port, ssl=config.ssl, backlog=config.backlog)

    async def change(self, lan):
        if not isinstance(lan, bool):
            raise ValueError('Choose LAN access or local only.')
        async with self.lock:
            old_host = self.host
            new_host = '0.0.0.0' if lan else '127.0.0.1'
            if old_host != new_host:
                # close() stops new accepts; existing requests and generation workers continue.
                for listener in self.server.servers:
                    listener.close()
                try:
                    self.server.servers = [await self.bind(new_host)]
                except OSError as error:
                    self.server.servers = [await self.bind(old_host)]
                    raise ValueError(f'Could not change hosting mode: {error}') from error
            try:
                self.root.mkdir(parents=True, exist_ok=True)
                temp = self.root / 'hosting.json.tmp'
                temp.write_text(json.dumps({'lan': lan}))
                temp.replace(self.root / 'hosting.json')
            except OSError as error:
                if old_host != new_host:
                    for listener in self.server.servers:
                        listener.close()
                    self.server.servers = [await self.bind(old_host)]
                raise ValueError(f'Could not save hosting mode: {error}') from error
            self.host = self.server.config.host = new_host
            return self.status()
