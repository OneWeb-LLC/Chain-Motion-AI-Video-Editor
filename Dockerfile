FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY editor ./editor
COPY prompts ./prompts
COPY static ./static
COPY Work\ Flows ./Work\ Flows
COPY run.py ./

ENV FRAMEFORGE_SATELLITE=1
ENV FRAMEFORGE_DATA_ROOT=/data
EXPOSE 8787

CMD ["python", "run.py", "--satellite", "--port", "8787"]
