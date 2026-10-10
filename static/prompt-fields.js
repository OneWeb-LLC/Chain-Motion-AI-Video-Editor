export const HELP = {
  subject_definitions: 'Define each referenced subject and its source: <Subject 1> from <Picture 1>. Use Picture for frame anchors, Video for source structure, and Audio for supplied audio. Keep labels consistent.',
  summary: 'One English paragraph beginning with task types, such as [reference generation] or [video continuation + audio reference]. Use only labels defined above.',
  retention_analysis: 'One line per defined label. Visuals: fully_preserved, partially_preserved, attribute_transfer, or weak_reference. Audio: fully_copy, partially_copy, reference, or weak_reference.',
  detailed_description: 'Start with visual style, then [Shot 1]. Describe composition, subjects, lighting, action, camera movement and sound in playback order. Later cuts: [Shot 2] At 00:03.000. Use stable (S1) speaker IDs and <d>[English] spoken words.</d>; preserve the original dialogue language. Normally 350–500 English words.',
  overall_soundscape: 'Ambience and physical sounds across the clip. Explain reference-audio use for these layers. Keep dialogue in Detailed description; use N/A if absent.',
  non_diegetic_music: 'Audience-only score: instruments, tempo and how it develops. Explain any audio-reference relationship. Use N/A for no background music.',
};

export const LEGACY_HELP = {
  STYLE: 'Visual look, medium, lighting style, and overall aesthetic.',
  CAST: 'Who appears in the shot, their appearance, and reference image tags.',
  SETTING: 'Location, time of day, surroundings, and environmental details.',
  CAMERA: 'Framing, angle, lens, and camera movement.',
  ACTION: 'What happens in the shot and how the subjects move.',
  EMOTION: 'The mood, expressions, and emotional delivery.',
  DIALOGUE: 'Spoken lines, who says them, and how they are delivered.',
  SOUND: 'Ambient audio, music, and sound effects.',
  CONTINUITY: 'Details that should carry over between shots.',
};

// Preserve every original character, including headers, unrecognized text, and spacing.
export function parsePrompt(text) {
  const guidePattern = new RegExp('^[ \t]*(' + Object.keys(HELP).join('|') + '):[ \t]*', 'gm');
  const guideMatches = [...text.matchAll(guidePattern)];
  if (guideMatches.length) {
    const parts = [];
    if (guideMatches[0].index) parts.push({label:'Other text', header:'', value:text.slice(0,guideMatches[0].index)});
    guideMatches.forEach((m,i) => parts.push({label:m[1], header:m[0], value:text.slice(m.index+m[0].length,guideMatches[i+1]?.index ?? text.length)}));
    return parts;
  }
  const pattern = /^[ \t]*(?:\[([A-Z][A-Z _]*?)(?:[ \t]+\d+)?\][ \t]*|([A-Z][A-Z _]*):[ \t]*)/gm;
  const matches = [...text.matchAll(pattern)].filter(m => !/^SHOT(?: |$)/.test(m[1] || '') && !['SPEAKER','TONE','LINE','AMBIENT','EFFECTS','PLACE','DETAILS','TIME','LOOK'].includes(m[2]?.trim()));
  const parts = [];
  if (!matches.length) return [{label: 'Other text', header: '', value: text}];
  if (matches[0].index) parts.push({label:'Other text', header:'', value:text.slice(0,matches[0].index)});
  matches.forEach((m,i) => parts.push({label:(m[1] || m[2]).trim(), header:m[0], value:text.slice(m.index+m[0].length,matches[i+1]?.index ?? text.length)}));
  return parts;
}
export function joinPrompt(parts) {
  return parts.map(p => p.header + p.value).join('');
}
export function editPromptPart(parts, index, value) {
  const part = parts[index];
  if (!part.spacing) {
    const trailing = part.value.match(/\s*$/)[0];
    const leading = part.value.trim() ? part.value.match(/^\s*/)[0] : (part.header.trim().endsWith(']') ? '\n' : '');
    part.spacing = {leading, trailing};
  }
  part.value = part.spacing.leading + value + part.spacing.trailing;
  return joinPrompt(parts);
}
