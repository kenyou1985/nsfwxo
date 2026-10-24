import type { VideoPosePreset } from '../data/presetPoses';

/** 195 个视频姿势预设 → MiniMax H3 六段式、9 个 shot */
export function buildPoseH3Prompt(pose: VideoPosePreset): string {
  const raw = String(pose.prompt || '');
  const positive = (raw.split('负面：')[0] || raw).replace(/^正向[:：]\s*/, '').trim();
  const negative = (raw.split('负面：')[1] || '').trim();
  const cameras = [
    'wide establishing shot, full bodies and entire room visible',
    'medium frontal shot, both faces and hands visible',
    'three-quarter side shot, clear body geometry',
    'over-the-shoulder medium shot',
    'low-angle medium shot from the floor',
    'close-up on the point of contact, no face',
    'high-angle wide shot, full scene',
    'profile medium close-up, facial reaction',
    'wide ending shot, both bodies and environment visible',
  ];
  const shots = cameras.map((cam, i) => {
    const t = (i * 60 / 9).toFixed(1).padStart(4, '0');
    return `[Shot ${i + 1}] At 00:${t}.000, ${positive} Camera: ${cam}. Same pose, same clothing state, continuous motion from the previous shot.`;
  }).join('\n');

  return `subject_definitions:
<Subject 1> is @Woman <Picture 1> — the East Asian adult woman from the reference; preserve face, hair, body proportions and identity exactly.
<Subject 2> is @Man — an adult male partner; face stays out of close-ups unless the pose requires it.

summary:
[reference generation] A 60-second explicit adult sequence built from the "${pose.nameZh}" pose preset. Nine sequential shots of one continuous position with different camera angles and escalating physical detail.

retention_analysis:
<Subject 1> <Picture 1>: fully_preserved — face, hair and body proportions stay identical to the reference.

detailed_description:
${shots}

overall_soundscape: room tone, fabric friction, skin contact and breathing. Only the exact dialogue inside <d>...</d> tags may be spoken; no narrator, no extra voices.
non_diegetic_music: None
${negative ? `\nnegative: ${negative}` : ''}`;
}
