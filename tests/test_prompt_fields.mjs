import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../static/prompt-fields.js', import.meta.url));
const {parsePrompt, joinPrompt, editPromptPart} = await import('data:text/javascript;base64,' + source.toString('base64'));
for (const text of ['', 'Freeform\ntext', '[SHOT 1]\nSTYLE: paint\nCAST: <Picture 1>\nCAMERA: wide\n\n[DIALOGUE 1]\nSPEAKER: A\nLINE: Hello\n', '[STYLE]\nInk\n\n[CUSTOM]\nKeep this\n', 'STYLE: first\nSTYLE: second\n']) {
  assert.equal(joinPrompt(parsePrompt(text)), text);
}
const parts = parsePrompt('[SHOT 1]\nSTYLE: old\nCAST: <Picture 1>\n');
assert.equal(editPromptPart(parts, 1, 'new'), '[SHOT 1]\nSTYLE: new\nCAST: <Picture 1>\n');
const empty = parsePrompt('STYLE:\nCAST: someone');
assert.equal(editPromptPart(empty, 0, 'paint'), 'STYLE:paint\nCAST: someone');
assert.equal(editPromptPart(empty, 0, 'ink'), 'STYLE:ink\nCAST: someone');
assert.equal(parsePrompt('[DIALOGUE 1]\nSPEAKER: A\nLINE: Hello')[0].value, '\nSPEAKER: A\nLINE: Hello');
console.log('Prompt parsing and editing checks passed');
const guide = 'subject_definitions:\n<Subject 1> from <Picture 1>.\n\nsummary:\n[reference generation] A greeting.\n\nretention_analysis:\n<Subject 1>: fully_preserved - appearance.\n\ndetailed_description:\nCinematic style.\n[Shot 1] <Subject 1> (S1) says <d>[French] Bonjour!</d>\n[Shot 2] At 00:02.000, a wave.\n\noverall_soundscape:\nWind.\n\nnon_diegetic_music:\nN/A';
const guideParts = parsePrompt(guide);
assert.equal(guideParts.length, 6);
assert.equal(joinPrompt(guideParts), guide);
assert.equal(guideParts[3].label, 'detailed_description');
assert.ok(guideParts[3].value.includes('[Shot 2]'));
assert.equal(editPromptPart(guideParts, 1, '[reference generation] A wave.'), guide.replace('A greeting.', 'A wave.'));
console.log('Full-reference six-field preservation and editing checks passed');
