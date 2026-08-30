// Generator script for famous landmark exhibitionism templates.
// Run with: node scripts/generate_landmark_templates.js
// Outputs the full replacement block (TypeScript literal) to stdout.

const FEMALE_ACCESSORIES = [
  'silk stockings',
  'fishnet stockings',
  'opera gloves',
  'long satin gloves',
  'beret hat',
  'wide-brim felt hat',
  'fedora',
  'baseball cap',
  'pearl choker necklace',
  'long pendant necklace',
  'silk scarf around neck',
  'cashmere shawl',
  'fur stole',
  'leather belt with gold buckle',
  'ankle bracelet with charm',
  'wristwatch',
  'cat-eye sunglasses pushed up on head',
  'hair flower clip',
  'pearl hair pins',
  'silk hair ribbon',
  'layered pearl earrings',
  'tulle opera cape',
  'wide leather cuff bracelet',
];

function pickAccessories(seed, n) {
  const out = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    out.push(FEMALE_ACCESSORIES[Math.floor((s / 233280) * FEMALE_ACCESSORIES.length)]);
  }
  // de-dup
  const seen = new Set();
  const result = [];
  for (const a of out) {
    if (!seen.has(a)) { seen.add(a); result.push(a); }
  }
  return result;
}

const LOCATIONS = {
  eiffel_tower:        { en: 'Eiffel Tower observation deck at night',       zh: '巴黎埃菲尔铁塔观景台', scene: 'Eiffel Tower observation deck at night, Paris city lights below, metal lattice structure, cold wind' },
  times_square:        { en: 'Times Square New York at night',               zh: '纽约时代广场夜景',     scene: 'Times Square New York at night setting, giant glowing neon billboards, bright colorful LED screens, bustling crowds of pedestrians in soft bokeh background, urban night atmosphere' },
  great_wall:          { en: 'Great Wall of China at night',                zh: '北京长城城墙',         scene: 'Great Wall of China at night, ancient stone walls, mountains in distance, single lantern light' },
  colosseum:           { en: 'Roman Colosseum interior at night',           zh: '罗马斗兽场内部',       scene: 'Roman Colosseum at night, ancient stone arches, single torch light, soft warm glow' },
  pyramids:            { en: 'Egyptian pyramids at night',                  zh: '埃及金字塔脚下',       scene: 'Egyptian pyramids at night, massive stone blocks, desert wind, single lantern light' },
  sydney_opera:        { en: 'Sydney Opera House steps at night',           zh: '悉尼歌剧院台阶',       scene: 'Sydney Opera House at night, white shell roofs, harbor lights, single spotlight' },
  taj_mahal:           { en: 'Taj Mahal gardens at night',                  zh: '印度泰姬陵花园',       scene: 'Taj Mahal gardens at night, white marble dome, reflecting pool, single lantern light' },
  statue_liberty:      { en: 'Statue of Liberty base at night',              zh: '美国自由女神像基座',   scene: 'Statue of Liberty base at night, green copper, harbor lights, single spotlight' },
  machu_picchu:        { en: 'Machu Picchu terrace at night',               zh: '秘鲁马丘比丘露台',     scene: 'Machu Picchu terrace at night, ancient stone walls, mountains in distance, single lantern light' },
  burj_khalifa:        { en: 'Burj Khalifa observation deck at night',      zh: '迪拜哈利法塔观景台',   scene: 'Burj Khalifa observation deck at night, Dubai city lights below, glass walls, single spotlight' },
  guangzhou_tower:     { en: 'Canton Tower observation deck at night',      zh: '广州塔观景平台',       scene: 'Canton Tower observation deck at night, Guangzhou city lights below, glass walls, single spotlight' },
  shanghai_bund:       { en: 'Shanghai Bund at night',                      zh: '上海外滩夜景',         scene: 'Shanghai Bund at night, Huangpu River, Lujiazui skyline lights, single spotlight' },
  tiananmen_square:    { en: 'Tiananmen Square at night',                   zh: '北京天安门广场',       scene: 'Tiananmen Square at night, Tiananmen Gate, single spotlight, red walls' },
  terracotta_warriors: { en: 'Terracotta Warriors pit at night',            zh: '西安兵马俑坑道口',     scene: 'Terracotta Warriors pit at night, rows of ancient warriors, single lantern light' },
  west_lake:           { en: 'West Lake Broken Bridge at night',            zh: '杭州西湖断桥',         scene: 'West Lake Broken Bridge at night, lake lights, willow trees, single lantern light' },
  lijiang_old_town:    { en: 'Lijiang Old Town cobblestone street at night',zh: '丽江古城街道',         scene: 'Lijiang Old Town at night, cobblestone streets, red lanterns, single spotlight' },
  jinli_street:        { en: 'Chengdu Jinli Street at night',               zh: '成都锦里古街',         scene: 'Chengdu Jinli Street at night, red lanterns, traditional architecture, single spotlight' },
  huangshan_summit:    { en: 'Huangshan mountain summit at night',          zh: '黄山光明顶日出',       scene: 'Huangshan mountain summit at night, sea of clouds, ancient pine trees, single lantern light' },
  guilin_pier:         { en: 'Guilin Lijiang bamboo raft pier at night',    zh: '桂林漓江竹筏码头',     scene: 'Guilin Lijiang river at night, bamboo rafts, karst mountains, single lantern light' },
  victoria_harbor:     { en: 'Hong Kong Victoria Harbor Avenue of Stars at night', zh: '香港维多利亚港星光大道', scene: 'Hong Kong Victoria Harbor Avenue of Stars at night, harbor lights, skyline, single spotlight' },
};

// Per-template: outfit (English) and one SM toy (deterministic)
const TEMPLATE_CONFIG = {
  eiffel_tower:        { outfit: 'elegant black evening gown with matching long coat, heels',          toy: 'butt_plug',  accessorySeed: 17 },
  times_square:        { outfit: 'red satin cocktail dress with short leather jacket, heels',           toy: 'vibrating_egg', accessorySeed: 23 },
  great_wall:          { outfit: 'white silk cheongsam qipao with sheer shawl',                          toy: 'vibrating_egg', accessorySeed: 29 },
  colosseum:           { outfit: 'ivory toga-style draped dress with golden belt, sandals',             toy: 'butt_plug',  accessorySeed: 31 },
  pyramids:            { outfit: 'golden Egyptian-style linen sheath dress with beaded collar',          toy: 'strapon',    accessorySeed: 37 },  // dual
  sydney_opera:        { outfit: 'sky-blue chiffon evening dress with silver heels',                    toy: 'butt_plug',  accessorySeed: 41 },
  taj_mahal:           { outfit: 'deep red silk sari draped as evening gown, gold bangles',             toy: 'strapon',    accessorySeed: 43 },  // dual
  statue_liberty:      { outfit: 'navy blue formal gown with sequined bodice',                           toy: 'clit_sucker',accessorySeed: 47 },
  machu_picchu:        { outfit: 'earth-toned alpaca knit dress with woven belt, fedora hat',           toy: 'butt_plug',  accessorySeed: 53 },
  burj_khalifa:        { outfit: 'emerald green sequined evening gown, long satin gloves',              toy: 'clit_sucker',accessorySeed: 59 },
  guangzhou_tower:     { outfit: 'champagne satin qipao with high slit and silk shawl',                  toy: 'vibrating_egg', accessorySeed: 61 },
  shanghai_bund:       { outfit: 'black silk qipao with red trim and silk overcoat',                    toy: 'strapon',    accessorySeed: 67 },  // dual
  tiananmen_square:    { outfit: 'red silk cheongsam with golden phoenix embroidery and white fur shawl', toy: 'butt_plug',  accessorySeed: 71 },
  terracotta_warriors: { outfit: 'tan silk Hanfu-inspired dress with wide sleeves and jade pendant',     toy: 'vibrating_egg', accessorySeed: 73 },
  west_lake:           { outfit: 'pale green silk qipao with lotus embroidery and sheer shawl',          toy: 'clit_sucker', accessorySeed: 79 },
  lijiang_old_town:    { outfit: 'indigo blue Naxi-style embroidered tunic dress with silver jewelry',   toy: 'strapon',    accessorySeed: 83 },  // dual
  jinli_street:        { outfit: 'crimson silk Hanfu dress with golden trim and embroidered phoenix motif', toy: 'vibrating_egg', accessorySeed: 89 },
  huangshan_summit:    { outfit: 'pale grey Chinese silk tunic dress with wide sleeves, jade pendant',  toy: 'butt_plug',  accessorySeed: 97 },
  guilin_pier:         { outfit: 'emerald silk cheongsam with dragon embroidery',                       toy: 'clit_sucker', accessorySeed: 101 },
  victoria_harbor:     { outfit: 'midnight blue sequined mermaid gown with high slit',                   toy: 'vibrating_egg', accessorySeed: 103 },
};

// Dual-female (lesbian) templates: 4 of them (pyramids, taj_mahal, shanghai_bund, lijiang_old_town)
const DUAL_FEMALE_TEMPLATES = new Set(['pyramids', 'taj_mahal', 'shanghai_bund', 'lijiang_old_town']);

const TOYS = {
  butt_plug: {
    name: 'butt plug',
    panels: {
      3: 'large silver metallic butt plug with flared base and stem visibly inserted between her buttocks',
      4: 'large silver metallic butt plug with flared base and stem visibly inserted between her buttocks',
      5: 'large silver metallic butt plug with flared base and stem visibly inserted between her buttocks',
      6: 'large silver jeweled butt plug with decorative gem visibly inserted in her anus with metallic stem and flared base clearly seen between her cheeks',
      7: 'large silver metallic butt plug with flared base and stem visibly inserted between her buttocks',
      8: 'large silver jeweled butt plug with decorative gem visibly inserted in her anus with metallic stem and flared base clearly seen between her cheeks',
      9: 'large silver metallic butt plug with flared base and stem visibly inserted between her buttocks',
    },
  },
  vibrating_egg: {
    name: 'vibrating egg',
    panels: {
      3: 'small pink vibrating egg visibly inserted between her labia with thin transparent retrieval cord visible',
      4: 'small pink vibrating egg visibly inserted between her labia with thin transparent retrieval cord visible',
      5: 'small pink vibrating egg visibly inserted between her labia with thin transparent retrieval cord visible',
      6: 'small pink vibrating egg visibly inserted between her labia with thin transparent retrieval cord visible',
      7: 'small pink vibrating egg visibly inserted between her labia with thin transparent retrieval cord visible',
      8: 'wireless remote-controlled vibrating egg pressed against her clitoris by her own hand, the other hand between her spread thighs, eyes half-closed in pleasure',
      9: 'small pink vibrating egg visibly still inside her',
    },
  },
  clit_sucker: {
    name: 'clit suction',
    panels: {
      3: 'small rose-gold clit suction device attached to her clitoris with thin transparent air hose visible',
      4: 'small rose-gold clit suction device attached to her clitoris with thin transparent air hose visible',
      5: 'small rose-gold clit suction device attached to her clitoris with thin transparent air hose visible',
      6: 'small rose-gold clit suction device attached to her clitoris with thin transparent air hose visible',
      7: 'small rose-gold clit suction device attached to her clitoris with thin transparent air hose visible',
      8: 'small rose-gold clit suction device pressed against her clitoris during solo self-pleasure, eyes half-closed in pleasure',
      9: 'small rose-gold clit suction device still attached as she climaxes, mouth open in pleasure',
    },
  },
  strapon: {
    name: 'strap-on',
    panels: {
      3: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
      4: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
      5: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
      6: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
      7: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
      8: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
      9: 'glossy black strap-on harness buckled around her hips, curved purple silicone dildo visible',
    },
  },
};

const TOY_LABEL = {
  butt_plug: '肛塞',
  vibrating_egg: '跳蛋',
  clit_sucker: '阴贴',
  strapon: '假阳具',
};

// ---- 9-panel scene descriptions (Chinese) ----
const SCENE_DESCRIPTIONS_SOLO = [
  '【第1镜 · 正面全身·完整穿着】她穿完整衣服正面站立，全身可见，所有配饰齐全',
  '【第2镜 · 坐姿侧面·完整穿着】她坐姿侧面优雅，完整穿着展示侧脸轮廓',
  '【第3镜 · 撩裙·弯腰】她弯腰背对镜头撩起裙子露出大腿和臀部曲线',
  '【第4镜 · 半裸·背对弯曲】她半裸背对镜头弯腰展示背部曲线和臀部',
  '【第5镜 · 正面全裸·跪姿】她全裸正面跪姿，眼神大胆',
  '【第6镜 · 道具特写·跪趴】她全裸跪趴背对镜头，道具特写清晰展示',
  '【第7镜 · 阴部特写·俯视】俯视她张开双腿阴部细节和道具',
  '【第8镜 · 自慰·道具使用】她自慰时道具清晰展示，闭眼享受',
  '【第9镜 · 高潮·仰卧】她仰卧到达高潮，弓背张嘴道具仍可见',
];

const SCENE_DESCRIPTIONS_DUAL = [
  '【第1镜 · 双女主·正面全身】两位亚洲女性穿完整衣服正面并排站立，所有配饰齐全',
  '【第2镜 · 双女主·坐姿侧面】两位并排坐姿侧面，完整穿着展示优雅',
  '【第3镜 · 双女主·撩裙·弯腰】一位弯腰撩裙露出曲线，另一位站在身后抚摸腰部',
  '【第4镜 · 双女主·半裸·背对】一位半裸背对弯腰展示曲线，另一位站在身后抚摸',
  '【第5镜 · 双女主·69互舔】两人69姿势互相舔阴，口部紧贴对方阴部',
  '【第6镜 · 双女主·磨镜·道具】两人腿交叉磨镜，阴部贴阴部，道具参与',
  '【第7镜 · 双女主·假阳具插入】一位戴假阳具从后方插入另一位',
  '【第8镜 · 双女主·假阳具操作】一位戴假阳具在身后操作，另一位弯腰配合',
  '【第9镜 · 双女主·共同高潮】两人同时到达高潮，相拥张嘴呻吟',
];

// ---- 9-panel image prompts (English) ----
function soloPanelPrompt(i, cfg, loc, accessoryStr) {
  const toyKey = cfg.toy;
  const toyPanels = TOYS[toyKey].panels;
  switch (i) {
    case 0: // panel 1: front view, fully clothed
      return `Vertical full-body front shot, young asian woman wearing ${cfg.outfit}, ${accessoryStr}, standing front-facing in ${loc.en} with confident pose and soft eye contact toward camera, complete outfit visible with hands resting naturally at her sides, ${loc.scene}, cinematic soft glow on skin, photorealistic, 8k, shallow depth of field`;
    case 1: // panel 2: side profile seated, fully clothed
      return `Vertical medium side profile shot, young asian woman in ${cfg.outfit}, ${accessoryStr}, sitting on a stone bench or ledge in elegant side profile pose, knees together, one hand on her lap, long black hair falling over her shoulder, ${loc.scene}, cinematic soft warm glow, photorealistic, 8k, shallow depth of field`;
    case 2: // panel 3: rear view, half-undressed, jacket half-off
      return `Vertical medium rear shot, young asian woman in ${cfg.outfit} (jacket half-off shoulders, dress lifted up to her waist by one hand) bending forward at the waist in ${loc.en}, bare thighs and lower curves exposed, soft smile over shoulder toward camera, ${toyPanels[3]}, ${loc.scene}, cinematic rim light, photorealistic, 8k, shallow depth of field`;
    case 3: // panel 4: bent forward, half-undressed from behind
      return `Vertical medium rear shot, young asian woman fully naked from behind bent slightly forward at the waist in ${loc.en}, bare buttocks and lower back prominently in frame with detailed skin texture, ${toyPanels[4]}, smooth skin glistening under ambient light, ${loc.scene}, cinematic warm rim light tracing her body curves, intimate close-up composition, photorealistic, 8k, shallow depth of field`;
    case 4: // panel 5: front view, fully nude kneeling
      return `Vertical medium front shot, young asian woman fully naked kneeling upright in ${loc.en}, hands resting on her bare thighs, soft confident gaze directly at camera, ${toyPanels[5]}, full frontal nudity with intimate skin detail, ${loc.scene}, cinematic warm glow on her skin, photorealistic, 8k, shallow depth of field`;
    case 5: // panel 6: rear close-up showing toy + bent forward
      return `Vertical medium rear hip-level shot, young asian woman fully naked bending forward in ${loc.en}, both hands gripping a stone railing or surface, deeply arched back, exposed buttocks, ${toyPanels[6]}, soft skin glistening, ${loc.scene}, cinematic rim light tracing her spine, intimate composition, photorealistic, 8k, shallow depth of field`;
    case 6: // panel 7: top-down close-up
      return `Vertical top-down close-up between woman naked thighs in ${loc.en}, spread legs revealing vulva, ${toyPanels[7]}, ${loc.en} blurred far in background, intimate macro photography, soft skin detail, photorealistic, 8k, shallow depth of field`;
    case 7: // panel 8: solo self-pleasure / toy usage
      return `Vertical medium shot, young asian woman fully naked sitting in ${loc.en} with legs spread open wide, ${toyPanels[8]}, back arched slightly, ${loc.scene}, intimate solo composition with toy visible, photorealistic, 8k, shallow depth of field`;
    case 8: // panel 9: climax
      return `Vertical medium close-up shot, young asian woman fully naked lying on her back in ${loc.en}, back arched high off the ground, head thrown back, mouth open in intense orgasm, ${toyPanels[9]}, ${loc.scene}, intense cinematic climax composition, photorealistic, 8k, shallow depth of field`;
  }
}

function dualPanelPrompt(i, cfg, loc, accessoryStr) {
  const toyKey = cfg.toy;
  const toyPanels = TOYS[toyKey].panels;
  switch (i) {
    case 0: // panel 1: two women, fully clothed, front view
      return `Vertical full-body front shot, two young asian women (one Korean, one Japanese) both wearing ${cfg.outfit}, ${accessoryStr}, standing side by side in ${loc.en} with confident poses and soft eye contact toward camera, complete outfits visible with hands resting naturally at their sides, ${loc.scene}, cinematic soft glow on skin, photorealistic, 8k, shallow depth of field`;
    case 1: // panel 2: side profile seated together
      return `Vertical medium side profile shot, two young asian women (one Korean, one Japanese) in ${cfg.outfit}, ${accessoryStr}, sitting close together on a stone bench in elegant side profile pose, knees together, hands intertwined, long black hair flowing, ${loc.scene}, cinematic soft warm glow, photorealistic, 8k, shallow depth of field`;
    case 2: // panel 3: rear view of one, half-undressed
      return `Vertical medium rear shot, two young asian women in ${loc.en}, one bending forward at the waist with her outfit lifted to waist, bare thighs and lower curves exposed, the other standing behind her caressing her waist, ${toyPanels[3]}, ${loc.scene}, cinematic rim light, photorealistic, 8k, shallow depth of field`;
    case 3: // panel 4: rear view, naked from behind
      return `Vertical medium rear shot, one asian woman fully naked bent slightly forward in ${loc.en}, bare buttocks and lower back prominently in frame, the other woman standing behind her running her hand down her spine, ${toyPanels[4]}, smooth skin glistening, ${loc.scene}, cinematic warm rim light, intimate composition, photorealistic, 8k, shallow depth of field`;
    case 4: // panel 5: 69 oral composition
      return `Vertical medium shot, two asian women naked in 69 position on a soft silk sheet in ${loc.en}, one on top performing oral sex on the other who lies on her back with legs raised, faces pressed together at vulva level, glistening soft skin, tongues and vulvas in close contact, ${loc.scene}, warm intimate lighting, photorealistic, 8k, shallow depth of field`;
    case 5: // panel 6: scissoring / tribbing with toy
      return `Vertical medium close-up shot, two asian women naked in scissoring tribbing position in ${loc.en}, legs intertwined rubbing vulva against vulva, ${toyPanels[6]}, glistening soft skin, ${loc.scene}, cinematic warm glow tracing their curves, intimate composition, photorealistic, 8k, shallow depth of field`;
    case 6: // panel 7: strapon usage
      return `Vertical medium shot, two asian women naked in ${loc.en}, one wearing ${toyPanels[7]} on her partner who is bent over gripping a stone railing, strap-on dildo pressed against partner's vulva about to enter, both women moaning softly, ${loc.scene}, cinematic rim light, intimate composition, photorealistic, 8k, shallow depth of field`;
    case 7: // panel 8: strap-on penetration
      return `Vertical medium rear shot, two asian women naked in ${loc.en}, one bent forward while the other uses ${toyPanels[8]} on her from behind, ${loc.scene}, intimate composition, soft warm rim light, photorealistic, 8k, shallow depth of field`;
    case 8: // panel 9: mutual climax
      return `Vertical medium close-up shot, two asian women naked embracing in ${loc.en}, both reaching climax together, heads thrown back, mouths open in intense shared orgasm, ${toyPanels[9]}, ${loc.scene}, intense cinematic climax composition, photorealistic, 8k, shallow depth of field`;
  }
}

function escapeForTs(s) {
  // Escape single quotes / backticks if needed; we are writing into a JS template literal
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function generate(id) {
  const cfg = TEMPLATE_CONFIG[id];
  const loc = LOCATIONS[id];
  const isDual = DUAL_FEMALE_TEMPLATES.has(id);
  const accessories = pickAccessories(cfg.accessorySeed, isDual ? 3 : 2);
  const accessoryStr = accessories.join(', ');

  // basePrompt
  const basePrompt = isDual
    ? `cinematic storyboard grid in strict 9:16 vertical aspect ratio, 9 panels arranged in 3×3 grid, each panel is its own distinct moment, same setting and same two subjects across all 9 panels, two young asian women (one Korean, one Japanese, fair warm-beige porcelain skin, long silky black hair, dark almond eyes, delicate natural facial features, soft face contour, clear eyes, identical character face and body proportions preserved in every panel, anatomically correct female body with soft natural curves), female-female duo only — no man, ${loc.scene}, cinematic soft glow, gentle shadows, rich saturated colors, 8k ultra detail, shallow depth of field with 50mm prime lens look`
    : `cinematic storyboard grid in strict 9:16 vertical aspect ratio, 9 panels arranged in 3×3 grid, each panel is its own distinct moment, same setting and same subject across all 9 panels, consistent young asian woman across all 9 panels (Korean / Japanese / Chinese ethnicity, fair warm-beige porcelain skin, long silky black hair, dark almond eyes, delicate natural facial features, soft face contour, clear eyes), realistic skin texture with subtle pores, anatomically correct female body with soft natural curves, identical character face and body proportions preserved in every panel, solo female character only — no man, ${loc.scene}, cinematic soft glow, gentle shadows, rich saturated colors, 8k ultra detail, shallow depth of field with 50mm prime lens look`;

  const panelPrompts = isDual
    ? Array.from({ length: 9 }, (_, i) => dualPanelPrompt(i, cfg, loc, accessoryStr))
    : Array.from({ length: 9 }, (_, i) => soloPanelPrompt(i, cfg, loc, accessoryStr));

  const sceneDescs = isDual ? SCENE_DESCRIPTIONS_DUAL : SCENE_DESCRIPTIONS_SOLO;

  const panels = panelPrompts.map((p, i) => ({
    panel_number: i + 1,
    scene_description: sceneDescs[i],
    image_prompt: p,
  }));

  return {
    id,
    title: TEMPLATE_TITLES[id].title,
    titleZh: TEMPLATE_TITLES[id].titleZh,
    category: TEMPLATE_TITLES[id].category,
    description: TEMPLATE_TITLES[id].description,
    basePrompt,
    panels,
    _accessoryStr: accessoryStr,
    _toy: TOY_LABEL[cfg.toy],
  };
}

const TEMPLATE_TITLES = {
  eiffel_tower:        { title: 'Eiffel Tower Observation Deck',         titleZh: '巴黎埃菲尔铁塔观景台', category: '著名景点', description: '巴黎埃菲尔铁塔观景台中的多姿势露出剧情，肛塞特写镜头，配丝袜手套项链等配饰' },
  times_square:        { title: 'Times Square Night Exhibitionism',       titleZh: '纽约时代广场夜景露出', category: '著名景点', description: '纽约时代广场夜景中的多姿势露出剧情，跳蛋塞入阴部特写镜头，配帽子丝袜手套项链等配饰' },
  great_wall:          { title: 'Great Wall of China',                    titleZh: '北京长城城墙',         category: '著名景点', description: '北京长城城墙中的多姿势露出剧情，跳蛋塞入阴部特写镜头，配发饰丝巾披肩等配饰' },
  colosseum:           { title: 'Roman Colosseum',                        titleZh: '罗马斗兽场内部',       category: '著名景点', description: '罗马斗兽场内部中的多姿势露出剧情，肛塞特写镜头，配凉鞋腰带等配饰' },
  pyramids:            { title: 'Egyptian Pyramids Twin Lesbians',        titleZh: '埃及金字塔双女主露出', category: '著名景点', description: '埃及金字塔脚下双女主（韩国+日本）69互舔、磨镜、假阳具主题' },
  sydney_opera:        { title: 'Sydney Opera House Steps',               titleZh: '悉尼歌剧院台阶',       category: '著名景点', description: '悉尼歌剧院台阶中的多姿势露出剧情，肛塞特写镜头，配珍珠项链耳环等配饰' },
  taj_mahal:           { title: 'Taj Mahal Twin Lesbians',                titleZh: '印度泰姬陵双女主露出', category: '著名景点', description: '印度泰姬陵花园双女主（韩国+日本）69互舔、磨镜、假阳具主题' },
  statue_liberty:      { title: 'Statue of Liberty Base',                 titleZh: '美国自由女神像基座',   category: '著名景点', description: '美国自由女神像基座中的多姿势露出剧情，阴贴特写镜头，配长手套手表等配饰' },
  machu_picchu:        { title: 'Machu Picchu Terrace',                   titleZh: '秘鲁马丘比丘露台',     category: '著名景点', description: '秘鲁马丘比丘露台中的多姿势露出剧情，肛塞特写镜头，配费多拉帽丝袜腰带等配饰' },
  burj_khalifa:        { title: 'Burj Khalifa Observation Deck',          titleZh: '迪拜哈利法塔观景台',   category: '著名景点', description: '迪拜哈利法塔观景台中的多姿势露出剧情，阴贴特写镜头，配长手套皮草披肩等配饰' },
  guangzhou_tower:     { title: 'Canton Tower Observation Deck',          titleZh: '广州塔观景平台',       category: '中国著名', description: '广州塔观景平台中的多姿势露出剧情，跳蛋塞入阴部特写镜头，配耳环发夹等配饰' },
  shanghai_bund:       { title: 'Shanghai Bund Twin Lesbians',            titleZh: '上海外滩双女主露出', category: '中国著名', description: '上海外滩夜景双女主（韩国+日本）69互舔、磨镜、假阳具主题' },
  tiananmen_square:    { title: 'Tiananmen Square',                       titleZh: '北京天安门广场',       category: '中国著名', description: '北京天安门广场中的多姿势露出剧情，肛塞特写镜头，配丝袜毛披肩等配饰' },
  terracotta_warriors: { title: 'Terracotta Warriors',                    titleZh: '西安兵马俑坑道口',     category: '中国著名', description: '西安兵马俑坑道口中的多姿势露出剧情，跳蛋塞入阴部特写镜头，配玉坠耳环等配饰' },
  west_lake:           { title: 'West Lake Broken Bridge',                titleZh: '杭州西湖断桥',         category: '中国著名', description: '杭州西湖断桥中的多姿势露出剧情，阴贴特写镜头，配发带发夹等配饰' },
  lijiang_old_town:    { title: 'Lijiang Old Town Twin Lesbians',         titleZh: '丽江古城双女主露出', category: '中国著名', description: '丽江古城街道双女主（韩国+日本）69互舔、磨镜、假阳具主题' },
  jinli_street:        { title: 'Chengdu Jinli Street',                   titleZh: '成都锦里古街',         category: '中国著名', description: '成都锦里古街中的多姿势露出剧情，跳蛋塞入阴部特写镜头，配披风珍珠发饰等配饰' },
  huangshan_summit:    { title: 'Huangshan Mountain Summit',              titleZh: '黄山光明顶日出',       category: '中国著名', description: '黄山光明顶日出中的多姿势露出剧情，肛塞特写镜头，配玉坠丝巾等配饰' },
  guilin_pier:         { title: 'Guilin Lijiang Pier',                    titleZh: '桂林漓江竹筏码头',     category: '中国著名', description: '桂林漓江竹筏码头中的多姿势露出剧情，阴贴特写镜头，配发带发夹等配饰' },
  victoria_harbor:     { title: 'Hong Kong Victoria Harbor',              titleZh: '香港维多利亚港星光大道', category: '中国著名', description: '香港维多利亚港星光大道中的多姿势露出剧情，跳蛋塞入阴部特写镜头，配长手套皮草披肩等配饰' },
};

const ORDER = [
  'eiffel_tower', 'times_square', 'great_wall', 'colosseum', 'pyramids',
  'sydney_opera', 'taj_mahal', 'statue_liberty', 'machu_picchu', 'burj_khalifa',
  'guangzhou_tower', 'shanghai_bund', 'tiananmen_square', 'terracotta_warriors', 'west_lake',
  'lijiang_old_town', 'jinli_street', 'huangshan_summit', 'guilin_pier', 'victoria_harbor',
];

const out = ORDER.map(id => generate(id));

// Print as TypeScript literal we can paste into gridTemplates.ts
function tsEscape(s) {
  // Escape single quotes for use in JS strings; we're using template literal so just escape backticks and dollar signs
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function emitTemplate(t) {
  let s = '  {\n';
  s += `    id: '${t.id}',\n`;
  s += `    title: '${t.title.replace(/'/g, "\\'")}',\n`;
  s += `    titleZh: '${t.titleZh.replace(/'/g, "\\'")}',\n`;
  s += `    category: '${t.category}',\n`;
  s += `    description: '${t.description.replace(/'/g, "\\'")}',\n`;
  s += `    basePrompt: \`${tsEscape(t.basePrompt)}\`,\n`;
  s += '    panels: [\n';
  for (const p of t.panels) {
    s += `      { panel_number: ${p.panel_number}, scene_description: '${p.scene_description.replace(/'/g, "\\'")}', image_prompt: \`${tsEscape(p.image_prompt)}\` },\n`;
  }
  s += '    ],\n';
  s += '  },';
  return s;
}

console.log('// AUTO-GENERATED — DO NOT EDIT BY HAND');
console.log('// Re-run `node scripts/generate_landmark_templates.js > /tmp/landmark_templates.ts` to regenerate.');
console.log('');
out.forEach(t => {
  console.log(emitTemplate(t));
  console.log('');
});

// Summary
console.log('// ---- SUMMARY ----');
out.forEach(t => {
  const toy = TEMPLATE_CONFIG[t.id].toy;
  const dual = DUAL_FEMALE_TEMPLATES.has(t.id) ? 'DUAL' : 'SOLO';
  console.log(`// ${t.id.padEnd(22)} ${dual}  toy=${toy.padEnd(15)} accessories=[${t._accessoryStr}]`);
});