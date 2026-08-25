// Auto-generated - DO NOT EDIT MANUALLY

export interface ImagePosePreset {
  id: string;
  name: string;
  nameZh: string;
  prompt: string;
}

export interface VideoPosePreset {
  id: string;
  name: string;
  nameZh: string;
  prompt: string;
}

/**
 * IMAGE_POSE_PRESETS — 适配 Krea2 文生图模型的姿势预设
 *
 * Krea2 特点（基于 Qwen3VL 文本编码器）：
 * - 偏好自然语言完整句子，不适合 SD1.5/SDXL 那种 tag 堆叠
 * - 避免 `(word:1.3)` 这类权重标记语法
 * - 不需要 "8K ultra clear, masterpiece, best quality" 等通用堆砌
 * - 重视摄影/电影/构图词汇：photojournalistic, cinematic, studio lighting,
 *   shallow depth of field, natural light, film grain 等
 * - 重视氛围、情绪、叙事性描写
 * - 服饰/裸体用自然语言表达（"unclothed", "intimate scene"），不用 tag 风格
 */
export const IMAGE_POSE_PRESETS: ImagePosePreset[] = [

  {
    id: 'pose_1',
    name: '#1 Doggy Classic',
    nameZh: '床上经典Doggy猛烈后入',
    prompt: "An intimate scene captured in candid photojournalistic style. A young woman with long blonde hair and pale skin kneels on a soft bed in a deeply arched doggystyle pose, her face buried in the pillow with an expression of overwhelming pleasure, eyes half-closed and lips parted. Her partner kneels behind her, gripping her hips firmly as they move together with raw intensity. Warm bedside lamp light spills across rumpled white sheets, casting soft golden shadows across both unclothed bodies. Subtle sweat glistens on flushed skin. Shot on a 50mm prime lens at f/1.8 with shallow depth of field, the background melting into warm bokeh. Natural film grain, candid bedroom moment, emotional intensity, cinematic color grading with warm amber tones.",
  },

  {
    id: 'pose_2',
    name: '#2 Standing Doggy Wall',
    nameZh: '站立Doggy扶墙猛插',
    prompt: "A candid intimate moment captured in warm afternoon light. A slim young woman bends forward with her palms pressed against a textured plaster wall, her back arched and her breath caught in a soft moan, eyes half-closed with pleasure. Her partner stands close behind her, hands firmly holding her waist as their bodies press together in standing doggystyle. Both unclothed, with light sweat catching the natural daylight filtering through an unseen window. The scene is shot from a low cinematic side angle, shallow depth of field blurring the wall texture into soft tones. Natural skin texture, intimate atmosphere, film grain, 35mm lens aesthetic, warm color temperature.",
  },

  {
    id: 'pose_3',
    name: '#3 Prone Bone Deep',
    nameZh: 'Prone Bone趴式压入深插',
    prompt: "A raw and tender intimate scene photographed from above. A young woman lies face-down on cotton sheets with her hips slightly raised and back gently arched, her cheek pressed into the pillow as she lets out a muffled cry of pleasure, eyes closed and lips parted. Her partner presses close behind her, the weight of their body creating an intimate and intense atmosphere. Soft diffused bedroom light from a nearby window outlines the curves of their intertwined unclothed forms. Subtle perspiration on flushed skin, cinematic shallow depth of field, 50mm prime lens, warm amber color grading, natural film grain, candid emotional moment.",
  },

  {
    id: 'pose_4',
    name: '#4 Cowgirl Wild Ride',
    nameZh: 'Cowgirl女上位疯狂骑乘',
    prompt: "A dramatic and intimate portrait captured from a low cinematic angle. A young woman with disheveled hair sits astride her partner who lies beneath her on the bed, her hands braced against his chest as she moves with abandon, head thrown back, mouth open in a breathless gasp. Her hair and the soft light around her create a sense of motion and wildness. Both unclothed, with light catching on damp flushed skin. The bedroom is softly lit by a single warm bedside lamp, the rest falling into moody shadow. Shallow depth of field, 35mm lens aesthetic, natural film grain, candlelight tones, expressive intimate atmosphere.",
  },

  {
    id: 'pose_5',
    name: '#5 Reverse Cowgirl',
    nameZh: 'Reverse Cowgirl反向女上位',
    prompt: "An intimate rear-view composition captured with cinematic warmth. A young woman with long flowing hair sits facing away from her partner who lies on his back beneath her, her hips rolling in a slow and sensual rhythm. The soft curve of her back catches warm ambient bedroom light. Both unclothed, with skin tones glowing softly against darker shadowed surroundings. Shot with a shallow depth of field 50mm prime lens, the background dissolving into creamy bokeh. Film grain, warm golden tones, natural skin texture with subtle highlights, candid and emotionally charged atmosphere, photographic masterpiece of intimacy.",
  },

  {
    id: 'pose_6',
    name: '#6 Missionary Deep',
    nameZh: 'Missionary传教士深插抬腿',
    prompt: "A deeply intimate and tender moment photographed from a low angle at the foot of the bed. A young woman lies on her back with both legs raised and resting against her partner's shoulders, her face flushed with pleasure, mouth open in a soft gasp, eyes glazed and unfocused. Her partner leans close between her legs, the two locked in an intensely personal connection. Both unclothed, illuminated by warm diffused bedroom light from a bedside lamp. Shallow depth of field, 50mm prime lens, soft focus on faces, natural film grain, warm amber color grading, emotional and visually striking composition.",
  },

  {
    id: 'pose_7',
    name: '#7 Spooning Side',
    nameZh: 'Spooning侧卧后入缠绵',
    prompt: "A tender and intimate side profile composition in a soft-lit bedroom. A young woman lies on her side in the spooning embrace of her partner, one leg gently lifted, her head turned back for a soft, lingering kiss. The man behind her cradles her close, his hand gently cupping her breast. Both unclothed, with a thin sheen of warmth on their skin from the close contact. Soft warm light from a bedside lamp carves gentle shadows along the curve of her waist and hip. Cinematic shallow depth of field, 35mm prime lens, natural film grain, intimate and romantic atmosphere, warm pastel color grading.",
  },

  {
    id: 'pose_8',
    name: '#8 Against Wall Lift',
    nameZh: 'Against the Wall靠墙抱起站立插入',
    prompt: "A dramatic full-body portrait of raw intimacy captured in side profile. A young woman is held aloft against a textured bedroom wall by her partner, her legs wrapped firmly around his waist as they move as one. Her arms circle his neck, her face pressed close to his with an expression of surrender and pleasure. Both unclothed, with light catching on the perspiration of their exertion. Soft diffused light from a window outlines their intertwined silhouettes against the wall. Cinematic composition, 50mm prime lens, shallow depth of field, natural film grain, warm romantic color grading, emotionally charged.",
  },

  {
    id: 'pose_9',
    name: '#9 Lotus Intimate',
    nameZh: 'Lotus莲花坐姿亲密研磨',
    prompt: "A quiet and deeply intimate moment captured in soft frontal composition. Her partner sits on the edge of the bed in a relaxed seated position, the young woman facing close and straddling his lap with her legs wrapped gently around his waist, their foreheads pressed together in a deep and tender kiss. Both unclothed, with warm afternoon light from a window falling softly across their shoulders and the curve of their embracing forms. The scene radiates closeness and emotional connection. Shallow depth of field, 50mm prime lens, soft focus on faces, natural film grain, warm golden tones, romantic and sensual atmosphere.",
  },

  {
    id: 'pose_10',
    name: '#10 69 Mutual Oral',
    nameZh: '69互舔口交动态',
    prompt: "An artistically composed overhead shot of a tender mutual intimate moment. Two bodies lie in mirrored positions in the sixty-nine pose on rumpled white sheets, their limbs intertwined with a sense of shared pleasure and mutual giving. Soft afternoon light from a nearby window pools across the center of the composition, leaving the edges to fall into warm shadow. Unclothed, with natural skin tones and intimate details rendered with cinematic clarity. Shallow depth of field, 50mm prime lens, natural film grain, warm color grading, soft contrast, emotionally intimate and visually striking.",
  },

  {
    id: 'pose_11',
    name: '#11 Piledriver Deep',
    nameZh: 'Piledriver倒立深插',
    prompt: "A dramatic and visually striking inverted composition. A young woman is held suspended in a vertical position with her legs raised high above her head, her face flushed deep pink with overwhelming sensation, lips parted in a breathless gasp. Her partner supports her weight while standing close, the two locked together in an intensely demanding pose. Both unclothed, with light streaming from above to highlight the muscular tension in both bodies and the sheen of exertion on flushed skin. Dramatic side-angle composition, shallow depth of field, cinematic lighting from above, 50mm prime lens, film grain, emotionally charged atmosphere.",
  },

  {
    id: 'pose_12',
    name: '#12 Full Nelson Suspended',
    nameZh: 'Full Nelson全尼尔森抱起固定猛插',
    prompt: "A powerful full-body action portrait captured in dramatic side lighting. A young woman is held completely suspended in her partner's arms from behind, her legs restrained in a full nelson hold, her body lifted entirely off the ground. Her face shows complete surrender, mouth open in a breathless cry, eyes rolled back with overwhelming sensation. Both unclothed, with every muscle defined under the warm golden spotlight of a single hanging bulb. Shallow depth of field, 50mm prime lens, natural film grain, high contrast cinematic lighting, emotional intensity, candid action moment.",
  },

  {
    id: 'pose_13',
    name: '#13 Amazon Dominant',
    nameZh: 'Amazon女蹲上位强势骑乘',
    prompt: "A bold and intimate low-angle composition. Her partner lies on his back beneath her as the young woman assumes a powerful amazon squatting position, her feet planted firmly on the bed as she rises and falls with commanding rhythm. Her hair falls forward, her face alive with fierce concentration and pleasure. Both unclothed, with the overhead lamp casting strong shadows across the planes of their intertwined bodies. Shallow depth of field, 50mm prime lens, dramatic cinematic lighting from above, natural film grain, emotional and physical intensity, candid bedroom moment.",
  },

  {
    id: 'pose_14',
    name: '#14 Butterfly High Leg',
    nameZh: 'Butterfly蝴蝶式抬腿深插',
    prompt: "A striking composition shot from the foot of the bed. A young woman lies back at the edge of the mattress with both legs raised high in a butterfly pose, her partner standing between them in a powerful stance as they move together with deep rhythm. Her hands grip the sheets beside her, her face lifted in an expression of raw pleasure, eyes closed. Both unclothed, lit dramatically from one side by warm afternoon light that carves the curves of their bodies. Cinematic depth of field, 50mm prime lens, shallow focus on faces, film grain, golden hour color grading, emotionally intense.",
  },

  {
    id: 'pose_15',
    name: '#15 Standing Missionary',
    nameZh: 'Standing Missionary站立面对面',
    prompt: "A tender full-body portrait of standing intimacy captured from a frontal angle. A young woman stands face to face with her partner, one leg lifted and wrapped around his hip for balance, their bodies pressed together as they share a deep and breathless kiss. She balances on the other leg with effort, her face close to his with eyes closed in concentration. Both unclothed, with light catching the sheen of exertion on their warm skin. Soft natural window light, shallow depth of field, 50mm prime lens, cinematic warm tones, natural film grain, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_16',
    name: '#16 Wheelbarrow Standing',
    nameZh: 'Wheelbarrow手推车式站立后入',
    prompt: "A dynamic full-body composition captured in profile. A young woman is held suspended in a wheelbarrow-like pose, her legs gripped firmly by her partner who stands behind her, her hands braced against the floor as her body arches upward. Her face shows intense effort and overwhelming sensation, mouth open in a breathless cry. Both unclothed, with the bedroom's natural daylight streaming in to highlight the dramatic lines of their intertwined forms. Shallow depth of field, 35mm lens aesthetic, cinematic side lighting, natural film grain, candid action moment, emotionally charged.",
  },

  {
    id: 'pose_17',
    name: '#17 Leapfrog Low',
    nameZh: 'Leapfrog蛙跳式低后入',
    prompt: "A low-angle candid bedroom shot with dramatic perspective. A young woman kneels forward on the bed in a low leapfrog pose, her chest close to the mattress and hips raised high, her face turned sideways into the pillow with a soft moan escaping. Her partner kneels close behind her, the two connected in deep rhythm. Both unclothed, lit by the warm glow of a bedside lamp that pools golden light across the small of her back. Cinematic shallow depth of field, 50mm prime lens, natural film grain, warm amber tones, intimate and tender atmosphere.",
  },

  {
    id: 'pose_18',
    name: '#18 Pretzel Dip',
    nameZh: 'Pretzel Dip扭结侧入式',
    prompt: "An elegant and intimate side-profile composition. A young woman lies on her side with one leg stretched out and the other gently raised and held by her partner who kneels close, their bodies forming a graceful pretzel-like shape. She turns her head back to share a tender kiss with him, her free hand reaching back to touch his face. Both unclothed, with warm afternoon light falling softly across the lines of their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, soft warm color grading, romantic and emotionally intimate mood.",
  },

  {
    id: 'pose_19',
    name: '#19 G-Whiz Missionary',
    nameZh: 'G-Whiz抬腿传教士变体',
    prompt: "A dramatic frontal composition shot from above. A young woman lies on her back with both legs raised high and resting on her partner's shoulders as he kneels between them, leaning close with intense focus. Her face shows overwhelming pleasure, mouth open in a silent cry, eyes closed tightly. Both unclothed, with the soft glow of overhead lighting highlighting the sheen on her flushed skin and the tension in both their bodies. Cinematic depth of field, 50mm prime lens, natural film grain, warm color grading, emotionally intense and visually striking.",
  },

  {
    id: 'pose_20',
    name: '#20 Flatiron Low',
    nameZh: 'Flatiron平躺低后入',
    prompt: "A quietly intimate overhead composition with soft natural light. A young woman lies flat on her stomach with her hips gently raised, her face turned to the side with her cheek pressed into the pillow, eyes closed in a soft expression of pleasure. Her partner lies close on top of her, both unclothed and pressed together with their weight fully merged. The scene is lit by soft diffused daylight from a window, casting long gentle shadows across the rumpled sheets. Shallow depth of field, 50mm prime lens, natural film grain, warm tones, tender and emotionally intimate.",
  },

  {
    id: 'pose_21',
    name: '#21 Deep Impact',
    nameZh: 'Deep Impact深插抬腿变体',
    prompt: "A dramatic and emotionally intense close-up composition. A young woman lies on her back with her legs raised high overhead, her body folded nearly in half as her partner kneels close between them, leaning forward with focused intensity. Her face is flushed deep pink, her mouth open in a breathless expression of overwhelming sensation. Both unclothed, with warm cinematic light from above casting dramatic highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, golden hour color grading, cinematic and emotionally powerful.",
  },

  {
    id: 'pose_22',
    name: '#22 Reverse Prayer',
    nameZh: 'Reverse Prayer反向祈祷式后入',
    prompt: "A dramatic rear-view composition with strong cinematic lighting. A young woman kneels upright with her hands clasped behind her back in a reverse prayer position, her chest pushed forward and her head tilted back with an open-mouthed gasp of pleasure. Her partner kneels close behind her, the two connected with intense physical rhythm. Both unclothed, with warm directional light from a side window sculpting every curve of her arched back. Shallow depth of field, 50mm prime lens, natural film grain, warm amber tones, emotionally charged and visually powerful.",
  },

  {
    id: 'pose_23',
    name: '#23 Magic Mountain',
    nameZh: 'Magic Mountain魔法山后入',
    prompt: "A creatively composed bedroom scene with theatrical framing. A young woman lies prone across a stack of plump pillows that raise her hips into the air, her face buried in the soft bedding with a muffled cry escaping her lips. Her partner kneels behind her on the elevated surface, the two moving together with deep intensity. Both unclothed, with warm soft window light filtering through sheer curtains to create a dreamy glow. Shallow depth of field, 50mm prime lens, natural film grain, soft pastel color grading, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_24',
    name: '#24 Seated Scissors',
    nameZh: 'Seated Scissors坐姿剪刀式',
    prompt: "A tender and intimate seated composition shot from the front. Her partner sits upright on the edge of the bed while the young woman faces him, her legs wrapped around his waist in a seated scissors position, their bodies pressed close as they share a tender and lingering kiss. Both unclothed, with soft warm bedside lamp light falling gently across their shoulders and the lines of their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate and visually poetic.",
  },

  {
    id: 'pose_25',
    name: '#25 Table Top',
    nameZh: 'Table Top桌面式',
    prompt: "A dramatically lit composition with a modern editorial feel. A young woman lies back on the edge of a wooden table with her legs spread wide, her hands gripping the table edge as her partner stands close beside the table, the two moving together with commanding rhythm. Her face is lifted in an open-mouthed expression of overwhelming sensation. Both unclothed, with strong directional light from a single overhead pendant lamp casting dramatic shadows across the table surface and their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic high contrast, natural film grain.",
  },

  {
    id: 'pose_26',
    name: '#26 Crab Walk Cowgirl',
    nameZh: 'Crab Walk螃蟹行走式女上',
    prompt: "A dynamic and kinetic composition capturing wild motion. Her partner lies on his back as the young woman assumes a crab-walk position above him, her hands and feet planted firmly on the bed as she moves with frantic rhythm, her hair falling forward and her back arching with each movement. Both unclothed, with warm bedside lamp light catching the sheen of exertion across both their bodies. Shallow depth of field, 35mm lens aesthetic, cinematic side lighting, natural film grain, candid and emotionally intense action moment.",
  },

  {
    id: 'pose_27',
    name: '#27 Superman Suspended',
    nameZh: 'Superman悬空后入',
    prompt: "A powerful full-body composition capturing extraordinary physical connection. A young woman is held completely aloft in a superman-like horizontal position by her partner who stands behind her, her arms extended forward as if in flight, her face showing complete surrender to the intensity of the moment. Both unclothed, with strong side window light outlining the dramatic silhouette of her suspended body against a darker bedroom background. Shallow depth of field, 50mm prime lens, dramatic cinematic lighting, natural film grain, emotionally powerful and visually striking.",
  },

  {
    id: 'pose_28',
    name: '#28 Pinball Wizard',
    nameZh: 'Pinball Wizard弹球式快速浅插',
    prompt: "A high-energy composition capturing frenetic motion. A young woman lies back with her legs raised high, her body bouncing with each rapid rhythm of her partner who stands between her legs, alternating between quick shallow movements and deep powerful strokes. Her face shows overwhelming pleasure, mouth open in breathless gasps. Both unclothed, with strong overhead lamp light casting dramatic shadows that emphasize the kinetic energy of the scene. Shallow depth of field, 50mm prime lens, cinematic side lighting, natural film grain, candid action moment.",
  },

  {
    id: 'pose_29',
    name: '#29 Corkscrew Spiral',
    nameZh: 'Corkscrew螺旋式侧入',
    prompt: "A creative side-profile composition with elegant lines. A young woman lies on her side with one leg raised and bent, her partner kneeling close beside her, the two connected in a spiraling corkscrew-like rhythm. She turns her head to share a soft look with him, her free hand reaching back to caress his chest. Both unclothed, with soft warm afternoon light from a window painting gentle highlights along the curve of her hip and thigh. Shallow depth of field, 50mm prime lens, natural film grain, warm pastel tones, romantic and emotionally intimate.",
  },

  {
    id: 'pose_30',
    name: '#30 Bridge Raised Hip',
    nameZh: 'Bridge桥式抬臀',
    prompt: "A striking composition with strong architectural lines. A young woman holds herself in a yoga bridge pose, her hips and back raised high with only her shoulders and feet touching the bed, her partner kneeling close behind her and leaning over her arched form. Her arms tremble slightly with the effort, her face showing intense concentration mixed with pleasure. Both unclothed, with strong overhead light from a hanging bulb sculpting every line of her raised body. Shallow depth of field, 50mm prime lens, dramatic cinematic lighting, natural film grain, visually powerful.",
  },

  {
    id: 'pose_31',
    name: '#31 Doggy Leg Lift Variant',
    nameZh: 'Doggy with Leg Lift后入抬腿变体',
    prompt: "A dynamic low-angle composition with strong diagonal lines. A young woman kneels in doggystyle position with one leg raised high to the side, her body tilted into an asymmetrical stance as her partner kneels close behind her. Her face shows intense sensation, mouth open in a soft cry. Both unclothed, with warm natural light from a side window creating dramatic contrast across the lines of their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, cinematic warm tones, candid and emotionally charged.",
  },

  {
    id: 'pose_32',
    name: '#32 Kneeling Oral to Sex',
    nameZh: 'Kneeling Oral to Sex跪姿口交转插入',
    prompt: "An intimate sequence captured in a single artistic frame. A young woman kneels close before her seated partner in an act of tender oral intimacy, then transitions smoothly into being turned around into a doggystyle position on his lap. Both unclothed, with soft warm bedside lamp light caressing their forms and the soft bedding beneath them. The composition suggests fluid motion through subtle body positioning. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic color grading, emotionally intimate and visually poetic.",
  },

  {
    id: 'pose_33',
    name: '#33 Wall Press Standing',
    nameZh: 'Wall Press墙壁压入站立',
    prompt: "A dramatic standing composition against a textured wall. A young woman is pressed face first against a rustic plaster wall by her partner who stands close behind her, one of her legs raised high and supported by his arm as they move together with intense rhythm. Her hands brace against the wall for balance, her face turned slightly to the side with eyes closed. Both unclothed, with strong directional light from a side window sculpting the lines of their bodies. Shallow depth of field, 50mm prime lens, natural film grain, cinematic high contrast, emotionally charged.",
  },

  {
    id: 'pose_34',
    name: '#34 Lotus Bounce',
    nameZh: 'Lotus with Bounce莲花坐姿弹跳',
    prompt: "A tender and joyful intimate moment captured from the front. Her partner sits upright while the young woman faces him in his lap, her legs wrapped around his waist as she bounces with abandon, her breasts pressed against his chest. They share a deep and breathless kiss, their faces close together. Both unclothed, with soft warm window light falling across their shoulders and creating a halo of light around their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally intimate.",
  },

  {
    id: 'pose_35',
    name: '#35 Double Leg Shoulder',
    nameZh: 'Double Leg Over Shoulder双腿肩扛深插',
    prompt: "A dramatic composition shot from above with intense visual impact. A young woman lies on her back with both legs raised high overhead, resting against her partner's shoulders as he kneels between them, leaning forward with deep focus. Her face shows overwhelming sensation, mouth open in a continuous breathless gasp. Both unclothed, with warm light from above casting strong highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, dramatic cinematic overhead lighting, natural film grain, emotionally powerful.",
  },

  {
    id: 'pose_36',
    name: '#36 Standing Reverse Cowgirl',
    nameZh: 'Standing Reverse Cowgirl站立反向女上',
    prompt: "A full-body dynamic composition captured in side profile. A young woman is held aloft in a standing reverse cowgirl position, her back to her partner who supports her weight, her legs wrapped firmly around his waist as they move together with intense vertical rhythm. Her hair falls forward, her face showing fierce concentration. Both unclothed, with the bedroom's natural light creating a soft glow around their intertwined silhouettes. Shallow depth of field, 35mm lens aesthetic, cinematic side lighting, natural film grain, candid action moment, emotionally charged.",
  },

  {
    id: 'pose_37',
    name: '#37 Kneeling Missionary',
    nameZh: 'Kneeling Missionary跪姿传教士',
    prompt: "A tender kneeling composition with soft romantic framing. A young woman lies back on the bed with her upper body slightly raised, her legs wrapped gently around her partner's waist as he kneels close over her. They share a deep and tender kiss, their faces close together with eyes closed in concentration. Both unclothed, with soft warm afternoon light from a window painting gentle highlights across their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm pastel tones, romantic and emotionally intimate.",
  },

  {
    id: 'pose_38',
    name: '#38 Pile Driver Enhanced',
    nameZh: 'Pile Driver加强版倒立深插',
    prompt: "A visually arresting inverted composition with dramatic impact. A young woman is held in an enhanced piledriver position, her legs raised high overhead as he leans over her from a standing position, the two connected with intense vertical rhythm. Her face is deeply flushed, her mouth open in breathless gasps. Both unclothed, with strong overhead light creating dramatic shadows that emphasize the lines of their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally intense.",
  },

  {
    id: 'pose_39',
    name: '#39 Side Saddle Cowgirl',
    nameZh: 'Side Saddle侧鞍式女上',
    prompt: "A graceful and intimate composition shot from a side angle. Her partner lies on his back as the young woman sits sideways across his hips, one leg bent and the other stretched out, her hips rolling with sensual rhythm. Her hair falls to one side, her face showing soft pleasure. Both unclothed, with warm diffused light from a nearby lamp caressing their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, soft warm color grading, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_40',
    name: '#40 Elevated Doggy',
    nameZh: 'Elevated Doggy抬高后入',
    prompt: "A dynamic elevated composition shot from the side. A young woman kneels at the edge of the bed with her hips raised high, her partner standing behind her on the floor as they move together with commanding rhythm. Her body rocks forward and back with each stroke, her face turned to the side with eyes closed in pleasure. Both unclothed, with soft natural window light streaming in to highlight the curves of their bodies. Shallow depth of field, 50mm prime lens, natural film grain, warm tones, candid and emotionally intense.",
  },

  {
    id: 'pose_41',
    name: '#41 Wrapped Lotus',
    nameZh: 'Wrapped Lotus缠绕莲花',
    prompt: "A deeply tender and emotionally charged frontal composition. Her partner sits upright while the young woman wraps herself completely around him, her arms around his neck and legs around his waist, their foreheads pressed together in an intimate and lingering kiss. Both unclothed, with soft warm lamp light falling across their intertwined forms from the side, creating gentle highlights and shadows. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally powerful atmosphere.",
  },

  {
    id: 'pose_42',
    name: '#42 Standing Full Nelson',
    nameZh: 'Standing Full Nelson站立全尼尔森',
    prompt: "A powerful full-body action portrait capturing extraordinary physical intensity. A young woman is held completely suspended in the air in a standing full nelson hold, her partner supporting her entire weight from behind with arms locked around her thighs. Her body is fully restrained, mouth open in a breathless cry, eyes rolled back. Both unclothed, with strong directional light from a side window outlining the dramatic silhouette of her suspended body. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally powerful.",
  },

  {
    id: 'pose_43',
    name: '#43 Prone Bone Arch',
    nameZh: 'Prone Bone with Arch趴式拱背变体',
    prompt: "A visually striking composition with strong arching lines. A young woman lies face down on the bed with her back deeply arched and hips raised even higher, her face buried in the pillow with a muffled cry of pleasure. Her partner kneels close behind her, the two connected with deep rhythm. Both unclothed, with warm bedside lamp light pooling across the curve of her arched back. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, romantic and emotionally intimate.",
  },

  {
    id: 'pose_44',
    name: '#44 Butterfly Thrust',
    nameZh: 'Butterfly with Thrust床边蝴蝶猛插',
    prompt: "A dramatic and kinetic composition shot from a low angle at the foot of the bed. A young woman lies at the edge of the mattress in butterfly position with her legs raised high, her partner standing between them with his palms gripping her thighs as they move together with commanding rhythm. Her body shakes with each stroke, her face lifted in an expression of overwhelming sensation. Both unclothed, with strong overhead light creating dramatic contrast. Shallow depth of field, 50mm prime lens, natural film grain, cinematic high contrast.",
  },

  {
    id: 'pose_45',
    name: '#45 Reverse Spooning',
    nameZh: 'Reverse Spooning反向侧卧',
    prompt: "A tender and romantic side-profile composition. Her partner lies on his side while the young woman faces away from him in a reversed spooning position, their legs intertwined as they lie close together. He reaches around to gently cup her breast and place a tender kiss on her neck. Both unclothed, with soft warm light from a bedside lamp creating intimate golden highlights along the curves of their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate atmosphere.",
  },

  {
    id: 'pose_46',
    name: '#46 Chair Reverse Cowgirl',
    nameZh: 'Chair Reverse Cowgirl椅子反向骑乘',
    prompt: "A creative seated composition with editorial framing. Her partner sits on a wooden chair while the young woman straddles him backwards in reverse cowgirl position, her back to him as she bounces with abandon, her hands gripping his knees for balance. The chair creaks with each movement. Both unclothed, with strong directional light from a side window creating dramatic shadows across their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic warm tones, natural film grain, emotionally charged and visually striking.",
  },

  {
    id: 'pose_47',
    name: '#47 Missionary Leg Lock',
    nameZh: 'Missionary with Leg Lock传教士锁腿',
    prompt: "A passionate and intimate composition with strong emotional intensity. A young woman lies on her back with both legs tightly wrapped around her partner's waist in a deep missionary embrace, her partner leaning close over her with focused intensity. She reaches up to grasp his shoulders, her face showing overwhelming pleasure and connection, eyes glazed. Both unclothed, with warm soft light from above falling across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally powerful.",
  },

  {
    id: 'pose_48',
    name: '#48 Wall Doggy',
    nameZh: 'Standing Doggy against Wall靠墙站立后入',
    prompt: "A dynamic standing composition shot from the side. A young woman bends forward with both hands pressed against a textured wall for balance, her back arched and her hips pushed back, her partner standing close behind her as they move together with vigorous rhythm. Her body rocks forward with each stroke, her face turned to the side with a breathless expression. Both unclothed, with soft natural window light streaming in from behind. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intense.",
  },

  {
    id: 'pose_49',
    name: '#49 Cowgirl Lean Forward',
    nameZh: 'Cowgirl with Lean Forward女上前倾',
    prompt: "An intimate and artistic composition with elegant lines. Her partner lies on his back as the young woman sits astride him leaning forward, her hands braced against the bed beside his hips as she moves with deep rhythm, her hair falling forward. Both unclothed, with soft warm light from a bedside lamp creating intimate golden highlights across her shoulders and back. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_50',
    name: '#50 Ultimate Deep Prone',
    nameZh: 'Ultimate Deep Prone极致趴式深压',
    prompt: "A powerful and intense full-body composition capturing the ultimate prone embrace. A young woman lies face down on the bed with her partner pressed close on top of her, his body weight merging with hers as they move together with commanding rhythm. Her face is buried deep in the pillow, her body trembling with overwhelming sensation. Both unclothed, with warm soft light falling across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally powerful and visually striking.",
  },

  {
    id: 'pose_51',
    name: '#51 Standing Lotus',
    nameZh: 'Standing Lotus站立莲花',
    prompt: "A tender and emotionally intimate standing composition. A young woman is held aloft in a standing lotus position, her legs wrapped around her partner's waist as they face each other, sharing a deep and lingering kiss, her arms wrapped around his neck for support. Both unclothed, with soft warm window light falling across their intertwined forms and the curve of her back. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_52',
    name: '#52 Desk Missionary',
    nameZh: 'Desk Missionary桌面传教士',
    prompt: "A dramatically composed editorial-style scene. A young woman lies back on the edge of a wooden desk with her legs spread wide, her partner standing close beside the desk leaning over her with intense focus as they move together. Her hands grip the desk edge, her face showing overwhelming pleasure. Both unclothed, with strong overhead pendant lamp light casting dramatic shadows across the desk surface and their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic high contrast lighting, natural film grain, emotionally charged.",
  },

  {
    id: 'pose_53',
    name: '#53 Sofa Doggy',
    nameZh: 'Sofa Doggy沙发后入',
    prompt: "A domestic and intimate composition in a contemporary living room. A young woman kneels forward on a leather sofa with her hips raised high, her upper body bent over the back of the sofa as her partner kneels behind her on the floor, the two moving together with deep rhythm. Her voice carries through the quiet evening air. Both unclothed, with warm lamp light from a nearby table painting golden highlights across the leather and her arched back. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate.",
  },

  {
    id: 'pose_54',
    name: '#54 Aerial Fuck',
    nameZh: 'Aerial Fuck空中悬空插入',
    prompt: "A visually striking full-body composition capturing extraordinary suspension. A young woman is held completely aloft by her partner in a standing suspended embrace, her legs wrapped firmly around his waist as they move together with intense vertical rhythm, her arms around his neck for support. Her face shows complete surrender to the moment. Both unclothed, with strong side lighting outlining the dramatic silhouette of her suspended body against a darker room. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally powerful.",
  },

  {
    id: 'pose_55',
    name: '#55 Edge Bed Missionary',
    nameZh: 'Edge of Bed Missionary床边传教士',
    prompt: "A dramatic bedside composition shot from a low side angle. A young woman lies at the very edge of the mattress with her legs raised high and resting on her partner's shoulders as he stands between them at the bedside, leaning forward with focused intensity. Her body rocks with each stroke, her face showing overwhelming pleasure. Both unclothed, with soft warm light from a bedside lamp creating intimate golden highlights. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intense.",
  },

  {
    id: 'pose_56',
    name: '#56 Reverse Standing Doggy',
    nameZh: 'Reverse Standing Doggy反向站立后入',
    prompt: "A dynamic standing composition captured in rear view. A young woman stands bent forward facing away from her partner, her hands resting on her knees for support as her partner stands close behind her, the two connected with vigorous rhythm. Her hair sways with each movement, her voice carrying breathless cries. Both unclothed, with soft natural light from a side window streaming across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, candid and emotionally charged.",
  },

  {
    id: 'pose_57',
    name: '#57 Kneeling Reverse Cowgirl',
    nameZh: 'Kneeling Reverse Cowgirl跪姿反向女上',
    prompt: "A dramatic kneeling composition with strong vertical lines. Her partner kneels upright while the young woman kneels facing away from him in reverse cowgirl position on his lap, her hips moving with intense rhythm, her hands braced against his thighs for support. Her back arches gracefully with each movement. Both unclothed, with warm soft light from above falling across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, emotionally intense and visually striking.",
  },

  {
    id: 'pose_58',
    name: '#58 Side by Side Parallel',
    nameZh: 'Side by Side Parallel侧卧平行插入',
    prompt: "A tender and romantic parallel composition. A young woman and her partner lie side by side facing each other in a parallel position on soft white sheets, one of her legs gently raised and resting against his hip, their bodies pressed close as they share a tender and lingering kiss. Both unclothed, with soft warm afternoon light from a window painting gentle highlights across their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_59',
    name: '#59 Overhead Press',
    nameZh: 'Overhead Press头顶压入',
    prompt: "A dramatically intense overhead composition. A young woman lies on her back with her legs pressed high overhead toward her head, her body folded in an extreme angle as her partner kneels close between them leaning forward with commanding rhythm. Her face is deeply flushed, her mouth open in a continuous breathless cry. Both unclothed, with strong overhead light casting dramatic highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, dramatic cinematic lighting, natural film grain, emotionally powerful.",
  },

  {
    id: 'pose_60',
    name: '#60 Balcony Standing',
    nameZh: 'Balcony Standing阳台站立插入',
    prompt: "A cinematic outdoor intimate scene captured on a private balcony at dusk. A young woman bends forward with both hands gripping a wrought iron railing for balance, her partner standing close behind her as they move together with quiet intensity. The soft evening breeze catches her hair. Both unclothed, with the warm golden hour light of the setting sun painting their intertwined forms in amber and rose tones. Shallow depth of field, 50mm prime lens, natural film grain, warm cinematic color grading, romantic and emotionally intimate.",
  },

  {
    id: 'pose_61',
    name: '#61 Lap Dance to Fuck',
    nameZh: 'Lap Dance to Fuck膝上舞转插入',
    prompt: "A sensual and intimate seated composition. Her partner sits upright on the edge of the bed while the young woman faces him, first swaying with a slow and teasing lap dance rhythm, then lowering herself down onto his lap with abandon, her breasts bouncing with the movement. They share a breathless and lingering kiss. Both unclothed, with soft warm lamp light from the side caressing their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate and visually poetic.",
  },

  {
    id: 'pose_62',
    name: '#62 Double Leg Lock',
    nameZh: 'Double Leg Lock双腿锁腰',
    prompt: "A passionate and intense composition with strong emotional connection. A young woman lies on her back with both legs tightly wrapped around her partner's waist, her partner leaning close over her with deep focus as they move together with commanding rhythm. She reaches up to grasp his shoulders, her face showing overwhelming pleasure and connection, eyes unfocused. Both unclothed, with soft warm overhead light falling across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally powerful.",
  },

  {
    id: 'pose_63',
    name: '#63 Wall Slide',
    nameZh: 'Wall Slide墙壁滑行插入',
    prompt: "A dynamic vertical composition against a textured wall. A young woman is held suspended against a plaster wall with her legs wrapped around her partner's waist, the two sliding together in a slow and sensual rhythm, her body sliding up and down with each movement. Her arms circle his neck for support. Both unclothed, with soft warm window light from the side creating gentle highlights along the curves of their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate.",
  },

  {
    id: 'pose_64',
    name: '#64 Prone Pillow Prop',
    nameZh: 'Prone with Pillow Prop趴式枕头抬高',
    prompt: "An intimate and artistically composed overhead scene. A young woman lies face down on the bed with a plump pillow placed beneath her abdomen to raise her hips even higher, her face buried in the bedding with muffled cries of pleasure escaping her lips. Her partner kneels close behind her, leaning forward with focused intensity. Both unclothed, with soft warm lamp light pooling across the curve of her raised back. Shallow depth of field, 50mm prime lens, natural film grain, warm amber tones, romantic and emotionally intimate.",
  },

  {
    id: 'pose_65',
    name: '#65 Suspended Congress',
    nameZh: 'Ultimate Suspended Congress极致悬空缠绵',
    prompt: "A breathtaking full-body composition capturing the ultimate suspended embrace. A young woman is held completely aloft by her partner in a standing intimate hold, her legs wrapped firmly around his waist as they move together with intense rhythm, their faces pressed close in a tender and breathless kiss. Both unclothed, with strong directional light from a side window outlining the dramatic silhouette of their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally powerful and visually poetic.",
  },

  {
    id: 'pose_66',
    name: '#66 Sideways Cowgirl',
    nameZh: 'Sideways Cowgirl侧身女上骑乘',
    prompt: "A graceful and artistic composition shot from a side angle. Her partner lies on his back as the young woman assumes a sideways cowgirl position, one leg bent and the other stretched out as she moves with sensual rhythm, her hair flowing to one side and her body twisting elegantly. Both unclothed, with soft warm light from a bedside lamp creating intimate golden highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm amber tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_67',
    name: '#67 Ottoman Prone',
    nameZh: 'Ottoman Prone脚凳趴式后入',
    prompt: "A creatively composed scene with strong interior styling. A young woman lies forward across a velvet ottoman with her hips raised high, her hands gripping the edges for balance, her partner standing close behind her as they move together with commanding rhythm. Her face shows intense sensation. Both unclothed, with soft warm lamp light from a nearby side table painting intimate golden highlights across the velvet and her arched back. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally charged.",
  },

  {
    id: 'pose_68',
    name: '#68 Mirror Doggy',
    nameZh: 'Mirror Doggy镜子前狗爬式',
    prompt: "An artistically composed scene featuring a large bedroom mirror. A young woman kneels facing the mirror with her hips raised high, her partner kneeling close behind her as they move together with deep rhythm, their reflections visible in the glass creating a layered visual narrative. Both unclothed, with soft warm lamp light reflecting off the mirror surface and illuminating their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic color grading, emotionally intimate and visually poetic.",
  },

  {
    id: 'pose_69',
    name: '#69 Bathtub Sitting',
    nameZh: 'Bathtub Sitting浴缸坐姿插入',
    prompt: "A sensual and atmospheric composition in a vintage bathroom. Her partner sits on the edge of a clawfoot bathtub while the young woman faces him in his lap, her wet skin glistening with water droplets as they move together with slow and sensual rhythm. Both unclothed, with the soft natural light from a frosted window creating intimate highlights on their wet skin. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate and visually poetic atmosphere.",
  },

  {
    id: 'pose_70',
    name: '#70 Stair Standing',
    nameZh: 'Stair Standing楼梯站立后入',
    prompt: "A dynamic composition captured on a wooden staircase. A young woman stands bent forward with both hands gripping the stair railing for balance, her partner standing close behind her on the lower step as they move together with commanding rhythm, her body bobbing up and down with each movement. Both unclothed, with soft natural light from a nearby window painting gentle highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, candid and emotionally charged.",
  },

  {
    id: 'pose_71',
    name: '#71 Window Press',
    nameZh: 'Window Press窗边压入站立',
    prompt: "A dramatic standing composition against a floor-to-ceiling window. A young woman is pressed against the cool glass by her partner from the front, one of her legs raised high and supported by his arm as they move together with intense rhythm. Her hands press against the glass for balance, leaving faint impressions on the surface. Both unclothed, with the soft evening glow of city lights reflecting off the glass and illuminating their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, cool cinematic color grading, emotionally charged atmosphere.",
  },

  {
    id: 'pose_72',
    name: '#72 Ballerina Lift',
    nameZh: 'Ballerina Lift芭蕾抬腿站立',
    prompt: "An elegant standing composition with graceful lines. A young woman is held aloft by her partner in a ballet-inspired pose, one of her legs raised high in an elegant extension as they stand facing each other, the two moving together with controlled and rhythmic grace. Her arms wrap around his neck for support. Both unclothed, with soft natural light from a tall window painting gentle highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, romantic and emotionally intimate.",
  },

  {
    id: 'pose_73',
    name: '#73 Twisted Spoon',
    nameZh: 'Twisted Spoon扭转侧卧插入',
    prompt: "A tender and intimate twisted side-profile composition. A young woman lies on her side with her torso twisted to face her partner, one leg raised and wrapped around his hip, the two connected from a side angle as they share a tender and lingering kiss, her hand reaching up to caress his face. Both unclothed, with soft warm afternoon light from a window painting gentle highlights across their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm pastel tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_74',
    name: '#74 Elevated Reverse Cowgirl',
    nameZh: 'Elevated Reverse Cowgirl抬高反向女上',
    prompt: "A striking elevated composition with dramatic perspective. Her partner lies on his back with his hips raised on a plush pillow as the young woman sits facing away from him in reverse cowgirl position, her hips moving with vigorous rhythm, the deeper angle creating an intense visual impact. Both unclothed, with soft warm overhead light falling across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, emotionally intense and visually striking.",
  },

  {
    id: 'pose_75',
    name: '#75 Kneeling Lotus',
    nameZh: 'Kneeling Lotus跪姿莲花',
    prompt: "A tender kneeling composition with soft romantic framing. Her partner kneels upright while the young woman faces him in his lap in a lotus position, her legs wrapped gently around his waist as they move together with deep and sensual rhythm, sharing a soft and lingering kiss. Both unclothed, with soft warm window light from the side painting intimate golden highlights across their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm pastel tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_76',
    name: '#76 Desk Reverse Cowgirl',
    nameZh: 'Desk Reverse Cowgirl桌面反向骑乘',
    prompt: "A creatively composed editorial-style scene at a writing desk. Her partner sits on a desk chair while the young woman straddles him backwards in reverse cowgirl position on the desk edge, her hips moving with abandon as she grips the desk surface for balance. Both unclothed, with strong directional light from a desk lamp creating dramatic shadows across the wooden surface and their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic warm tones, natural film grain, emotionally charged and visually striking.",
  },

  {
    id: 'pose_77',
    name: '#77 Couch Lap Reverse',
    nameZh: 'Couch Lap Reverse沙发膝上反向',
    prompt: "A domestic and intimate seated composition in a contemporary living room. Her partner sits on a soft sofa while the young woman straddles him backwards in reverse cowgirl position on his lap, her hips bouncing with vigorous rhythm against his thighs. Both unclothed, with warm lamp light from a nearby side table painting intimate golden highlights across the sofa fabric and their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally intimate atmosphere.",
  },

  {
    id: 'pose_78',
    name: '#78 Wall Mounted',
    nameZh: 'Wall Mounted墙壁固定悬空',
    prompt: "A powerful full-body composition capturing extraordinary suspension against a wall. A young woman is pinned against a textured plaster wall by her partner, completely suspended with her legs wrapped firmly around his waist as they move together with intense rhythm. Her body is fully restrained, her face showing complete surrender to the intensity of the moment. Both unclothed, with strong directional light from a side window outlining the dramatic silhouette of her suspended body. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally powerful.",
  },

  {
    id: 'pose_79',
    name: '#79 Floor Missionary',
    nameZh: 'Floor Missionary地板传教士',
    prompt: "A raw and intimate composition shot from above on a wooden floor. A young woman lies on her back with her legs spread wide, her partner lying close on top of her as they move together with deep rhythm, their faces close together in a tender and lingering kiss, eyes locked in connection. Both unclothed, with soft natural light from a nearby window painting gentle highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_80',
    name: '#80 Ultimate Yoga Bridge',
    nameZh: 'Ultimate Yoga Bridge极致瑜伽桥式',
    prompt: "A striking composition with strong architectural lines inspired by yoga. A young woman holds herself in an elevated bridge pose, her hips and back raised high with only her shoulders and feet touching the floor, her partner kneeling close beside her, leaning over her arched form as they move together. Her arms tremble slightly with the effort. Both unclothed, with strong overhead light sculpting every line of her raised body. Shallow depth of field, 50mm prime lens, dramatic cinematic lighting, natural film grain, visually powerful.",
  },

  {
    id: 'pose_81',
    name: '#81 Standing Split',
    nameZh: 'Standing Split站立劈腿插入',
    prompt: "An elegant standing composition with dramatic lines. A young woman is held aloft by her partner in a standing split position, one of her legs raised high in an elegant extension as they face each other, the two connected with intense rhythm. Her other leg barely touches the ground for balance, her arms wrapped around his neck for support. Both unclothed, with soft natural window light painting gentle highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally powerful and visually striking.",
  },

  {
    id: 'pose_82',
    name: '#82 Rocking Horse',
    nameZh: 'Rocking Horse摇马式女上',
    prompt: "A dynamic seated composition with kinetic motion. Her partner lies on his back as the young woman sits astride him in a rocking horse position, her hips swaying back and forth with sensual rhythm, her hands pressing against his chest for leverage as her hair flows with each movement. Both unclothed, with soft warm lamp light from the side caressing their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_83',
    name: '#83 Viennese Oyster',
    nameZh: 'Viennese Oyster维也纳牡蛎深折',
    prompt: "A dramatically intense composition with extreme visual impact. A young woman lies on her back with her legs extremely folded and pressed close to her chest in a Viennese oyster pose, her partner leaning close over her with commanding rhythm as they move together with deep intensity. Her face shows overwhelming pleasure, mouth open in continuous breathless gasps. Both unclothed, with strong overhead light casting dramatic highlights across their intertwined forms. Shallow depth of field, 50mm prime lens, dramatic cinematic lighting, natural film grain, emotionally powerful.",
  },

  {
    id: 'pose_84',
    name: '#84 Sphinx Prone',
    nameZh: 'Sphinx狮身人面趴式',
    prompt: "An artistically composed prone scene inspired by the sphinx pose. A young woman lies forward with her upper body slightly raised and her chest pushed forward, her arms supporting her weight as her partner kneels close behind her, leaning over her arched form with focused intensity. Both unclothed, with soft warm lamp light from the side caressing the lines of her raised body and the bedding beneath. Shallow depth of field, 50mm prime lens, natural film grain, warm romantic tones, emotionally charged atmosphere.",
  },

  {
    id: 'pose_85',
    name: '#85 Jellyfish Suspended',
    nameZh: 'Jellyfish水母悬空缠绕',
    prompt: "A breathtaking full-body composition capturing complete suspension. A young woman is held completely aloft by her partner in a jellyfish-like suspended embrace, her legs wrapped firmly around his waist and her arms around his neck, their bodies pressed close together as they move with deep rhythm. Her face shows overwhelming sensation. Both unclothed, with strong side lighting outlining the dramatic silhouette of their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally powerful and visually poetic.",
  },

  {
    id: 'pose_86',
    name: '#86 Tango Standing',
    nameZh: 'Tango探戈式站立缠绵',
    prompt: "An elegant standing composition inspired by tango dance. A young woman stands facing her partner, one of her legs wrapped gracefully around his waist as they hold each other close, their bodies pressed together in a slow and sensual rhythm, sharing a tender and lingering kiss. Both unclothed, with soft warm lamp light from the side painting intimate golden highlights across their embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm pastel tones, romantic and emotionally intimate atmosphere.",
  },

  {
    id: 'pose_87',
    name: '#87 Fusion Tight',
    nameZh: 'Fusion融合紧密贴合',
    prompt: "A deeply intimate seated composition with strong emotional connection. Her partner sits upright while the young woman wraps herself completely around him, her legs locked tightly around his waist, their chests pressed together as they move with abandon, sharing a deep and breathless kiss. Both unclothed, with soft warm window light from the side creating gentle highlights across their tightly embracing forms. Shallow depth of field, 50mm prime lens, natural film grain, warm golden tones, romantic and emotionally powerful atmosphere.",
  },

  {
    id: 'pose_88',
    name: '#88 Banana Split',
    nameZh: 'Banana Split香蕉劈腿',
    prompt: "A striking composition with strong visual lines. A young woman lies on her back with her legs spread wide in a banana split position, her partner kneeling close between them as they move together with commanding rhythm, her hands gripping the sheets beside her with overwhelming sensation. Both unclothed, with soft warm overhead light falling across their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, romantic and emotionally intense atmosphere.",
  },

  {
    id: 'pose_89',
    name: '#89 Octopus Wrap',
    nameZh: 'Octopus章鱼缠绕式',
    prompt: "A breathtaking full-body composition capturing total entanglement. A young woman wraps her legs and arms completely around her partner like an octopus, her body coiled around his in a suspended embrace as they move together with deep rhythm. Both unclothed, with strong side lighting outlining the dramatic silhouette of their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic dramatic lighting, natural film grain, emotionally powerful and visually poetic atmosphere.",
  },

  {
    id: 'pose_90',
    name: '#90 Throne Cowgirl',
    nameZh: 'Throne宝座坐姿女上',
    prompt: "A regal seated composition with editorial framing. Her partner sits upright on an ornate chair like a throne while the young woman faces him, straddling his lap as she moves with abandon, her hands resting on his shoulders for leverage, her expression one of fierce pleasure and connection. Both unclothed, with strong directional light from a nearby window creating dramatic shadows across the chair and their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic warm tones, natural film grain, emotionally charged atmosphere.",
  },

  {
    id: 'pose_91',
    name: '#91 Eclipse Back Arch',
    nameZh: 'Eclipse日食遮挡插入',
    prompt: "A dramatic rear-view composition with theatrical framing. A young woman stands facing away from her partner, her upper body leaning back toward him in an eclipse-like arch, his hands supporting her body as they move together with commanding rhythm. Her head falls back with overwhelming sensation. Both unclothed, with strong directional light from the side sculpting the dramatic lines of her arched back. Shallow depth of field, 50mm prime lens, cinematic high contrast, natural film grain, emotionally powerful and visually striking.",
  },

  {
    id: 'pose_92',
    name: '#92 Tidal Wave Rear',
    nameZh: 'Tidal Wave潮汐波浪后入',
    prompt: "A dynamic kneeling composition with rhythmic motion. A young woman kneels with her hips raised high in a tidal wave-like undulation, her partner kneeling close behind her, the two moving together with deep and rhythmic intensity, her body rocking back and forth with each stroke like waves. Both unclothed, with soft warm lamp light from the side caressing their intertwined forms. Shallow depth of field, 50mm prime lens, natural film grain, warm amber color grading, romantic and emotionally intense atmosphere.",
  },

  {
    id: 'pose_93',
    name: '#93 Phoenix Rising Stand',
    nameZh: 'Phoenix凤凰浴火重生站立',
    prompt: "A breathtaking full-body composition capturing transformation. A young woman is held aloft by her partner in a phoenix-rising inspired pose, her legs wrapped around his waist as they stand together, her hair flowing back as if caught in flames, her face showing fierce surrender to the moment. Both unclothed, with strong golden hour light from a window painting their intertwined forms in amber and rose tones. Shallow depth of field, 50mm prime lens, natural film grain, warm cinematic color grading, emotionally powerful.",
  },

  {
    id: 'pose_94',
    name: '#94 Dragon Wrap Deep',
    nameZh: 'Dragon龙缠绕深插',
    prompt: "A dramatic full-body composition capturing legendary entanglement. A young woman wraps her legs tightly around her partner like a coiling dragon, her partner pressing close to her as they move together with intense rhythm, their bodies pressed together with overwhelming sensation. Both unclothed, with strong directional light from a side window sculpting the dramatic lines of their intertwined forms. Shallow depth of field, 50mm prime lens, cinematic warm tones, natural film grain, emotionally powerful and visually striking.",
  },

  {
    id: 'pose_95',
    name: '#95 Cosmic Floating Intimate',
    nameZh: 'Cosmic宇宙悬浮缠绵',
    prompt: "A dreamlike full-body composition capturing floating intimacy. A young woman is held completely aloft by her partner in a cosmic-inspired suspended embrace, their eyes locked in deep connection as they share a tender kiss, her legs wrapped firmly around his waist as they drift together in slow and sensual rhythm. Both unclothed, with soft warm dreamy light painting their intertwined forms with ethereal highlights. Shallow depth of field, 50mm prime lens, natural film grain, warm cinematic color grading, romantic and emotionally powerful atmosphere.",
  },

];

/** 视频姿势预设 — 中文风格，用于图生视频模块（不是 Krea2 工作流） */
export const VIDEO_POSE_PRESETS: VideoPosePreset[] = [

  {
    id: 'pose_1',
    name: '#1 Doggy Classic',
    nameZh: '床上经典Doggy猛烈后入',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性深色皮肤粗大厚实黑色阴茎，从后面猛烈抽插苗条年轻女性长金发苍白皮肤，在床上后入式姿势，女性屁股高高翘起背部深深拱起脸埋枕头大声呻吟眼睛翻白，男性双手紧抓臀部用力撞击每一下都深插到底，汗水飞溅真实淫水顺大腿狂流，皮肤碰撞声清晰，动态侧面跟随镜头+特写插入画面，流畅60fps真实物理运动，电影感柔和卧室灯光，超详细皮肤纹理血管和湿润阴道，硬核激烈性爱8K',
  },

  {
    id: 'pose_2',
    name: '#2 Standing Doggy Wall',
    nameZh: '站立Doggy扶墙猛插',
    prompt: '高精度写实动态4K成人视频，高大肌肉黑人男性站在苗条年轻女性身后，站立后入式猛烈抽插，她向前弯腰双手扶墙屁股向后猛顶，嘴巴大张连续呻吟眼睛半闭，男性强壮双手死死抓住腰部粗大黑色阴茎高速深插湿润阴道，汗水从两人身体飞溅，乳白色淫水不断滴落，动态低角度镜头跟随臀部撞击，流畅60fps真实物理，电影感光影，超详细皮肤纹理和血管，硬核激烈性爱8K',
  },

  {
    id: 'pose_3',
    name: '#3 Prone Bone Deep',
    nameZh: 'Prone Bone趴式压入深插',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性全身压在苗条年轻女性身上采取趴式后入，女性脸朝下屁股微微抬起背部拱起脸压床单大声呻吟，男性用体重完全压住她粗大黑色阴茎用力深插到底双手按住手腕，汗水淋漓淫水被挤出滴落，动态俯视+侧面交替镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_4',
    name: '#4 Cowgirl Wild Ride',
    nameZh: 'Cowgirl女上位疯狂骑乘',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺床上，苗条年轻女性跨坐在他身上女上位疯狂上下套弄，双手撑胸口头向后仰乳房剧烈晃动嘴巴张开尖叫，男性双手紧抓她屁股辅助向上顶撞，粗大黑色阴茎完全没入湿润阴道淫水四溅，动态正面+低角度镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_5',
    name: '#5 Reverse Cowgirl',
    nameZh: 'Reverse Cowgirl反向女上位',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺床上，苗条年轻女性背对他反向女上位猛烈上下套弄屁股肉浪狂晃，双手撑大腿粗大黑色阴茎被阴道完全包裹血管清晰可见，淫水顺着阴茎不断滴落，动态后方特写+侧面镜头，流畅60fps真实物理运动，电影感卧室灯光，超详细皮肤纹理和湿润插入细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_6',
    name: '#6 Missionary Deep',
    nameZh: 'Missionary传教士深插抬腿',
    prompt: '高精度写实动态4K成人视频，高大肌肉黑人男性压在苗条年轻女性身上传统传教士姿势，她双腿被抬高搭在肩膀上大张，粗大黑色阴茎用力深深插入滴水阴道每一下都撞到底，女性脸部极度愉悦嘴巴大张尖叫眼神迷离，男性双手按住大腿深插，汗水滴落动态正面特写+侧面镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_7',
    name: '#7 Spooning Side',
    nameZh: 'Spooning侧卧后入缠绵',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性从后面抱住苗条年轻女性侧卧后入，一条腿被抬起粗大黑色阴茎从后方滑入湿润阴道，女性转头亲吻嘴巴微微张开呻吟，男性手揉捏乳房，缓慢到快速抽插淫水滴落，动态侧面跟随镜头+特写插入，流畅60fps真实物理运动，柔和温暖电影感灯光，超详细皮肤纹理和淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_8',
    name: '#8 Against Wall Lift',
    nameZh: 'Against the Wall靠墙抱起站立插入',
    prompt: '高精度写实动态4K成人视频，高大肌肉黑人男性将苗条年轻女性抱起靠在卧室墙上站立插入，双腿缠绕他腰间后背紧贴墙壁，粗大黑色阴茎向上猛烈抽插，女性手臂环抱脖子脸部极度愉悦呻吟，汗水顺身体流下动态侧面+低角度镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和插入细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_9',
    name: '#9 Lotus Intimate',
    nameZh: 'Lotus莲花坐姿亲密研磨',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐在床上莲花坐姿，苗条年轻女性面对面跨坐双腿缠腰，亲密深层插入，粗大阴茎完全没入体内缓慢研磨旋转，热情接吻双手环抱脖子，女性身体轻颤呻吟，动态正面亲密镜头+慢动作特写，流畅60fps真实物理，柔和浪漫电影感灯光混合欲望，超详细湿润结合处皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_10',
    name: '#10 69 Mutual Oral',
    nameZh: '69互舔口交动态',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性与苗条年轻女性床上69姿势，女性在上方吞含粗大黑色阴茎嘴唇撑开口水拉丝滴落，男性下方疯狂舔弄阴道并手指插入淫水沾满脸部，双方同时激烈口交动态上下交替特写镜头，流畅60fps真实物理，电影感柔和灯光，超详细口交液体和愉悦表情，硬核激烈性爱8K',
  },

  {
    id: 'pose_11',
    name: '#11 Piledriver Deep',
    nameZh: 'Piledriver倒立深插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性双腿被高举过头身体几乎倒立，肌肉黑人男性站立从上方猛烈向下深插粗大黑色阴茎，女性脸部充血极度愉悦呻吟嘴巴大张，汗水飞溅淫水倒流，动态侧面+俯视特写镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和插入画面，硬核激烈性爱8K',
  },

  {
    id: 'pose_12',
    name: '#12 Full Nelson Suspended',
    nameZh: 'Full Nelson全尼尔森抱起固定猛插',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性从后面用双臂锁住苗条年轻女性双腿（Full Nelson姿势）完全抱起悬空，粗大黑色阴茎猛烈向上抽插无法挣脱，女性身体被完全控制嘴巴大张尖叫眼睛翻白，汗水狂流动态正面+环绕镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_13',
    name: '#13 Amazon Dominant',
    nameZh: 'Amazon女蹲上位强势骑乘',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺床上，苗条年轻女性蹲在他身上Amazon姿势双脚踩床猛烈上下蹲起套弄，双手扶他胸口乳房剧烈晃动，粗大黑色阴茎被完全吞没淫水四溅，动态低角度特写阴道+正面镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_14',
    name: '#14 Butterfly High Leg',
    nameZh: 'Butterfly蝴蝶式抬腿深插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性躺在床边双腿高高抬起呈蝴蝶式，肌肉黑人男性站立床边粗大黑色阴茎猛烈抽插，女性双手抓床单尖叫愉悦身体随节奏晃动，动态侧面跟随+插入特写镜头，流畅60fps真实物理运动，电影感卧室灯光，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_15',
    name: '#15 Standing Missionary',
    nameZh: 'Standing Missionary站立面对面',
    prompt: '高精度写实动态4K成人视频，高大肌肉黑人男性将苗条年轻女性一条腿抬高站立面对面插入，粗大黑色阴茎深插到底两人贴紧亲吻，女性另一腿勉强站立呻吟，汗水交融动态正面+侧面交替镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_16',
    name: '#16 Wheelbarrow Standing',
    nameZh: 'Wheelbarrow手推车式站立后入',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站在后面抓住苗条年轻女性双腿抬起像手推车一样，女性双手撑地身体悬空，粗大黑色阴茎从后面猛烈抽插湿润阴道，女性手臂颤抖屁股剧烈晃动嘴巴大张连续尖叫，汗水飞溅淫水顺大腿狂流，动态侧面跟随镜头+低角度特写插入，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理血管和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_17',
    name: '#17 Leapfrog Low',
    nameZh: 'Leapfrog蛙跳式低后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪姿低头胸部贴床屁股高高抬起像蛙跳式，肌肉黑人男性从后面站立猛烈撞击粗大黑色阴茎深插到底，女性脸埋床单呻吟身体前倾，男性双手按住腰部高速抽插汗水滴落淫水四溅，动态后方特写+侧面镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_18',
    name: '#18 Pretzel Dip',
    nameZh: 'Pretzel Dip扭结侧入式',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性侧躺一条腿伸直另一条腿被肌肉黑人男性抬起跨过，男性跪姿从侧面深插粗大黑色阴茎，女性转头亲吻呻吟乳房晃动，缓慢到快速抽插淫水滴落，动态侧面交替镜头+插入特写，流畅60fps真实物理运动，电影感温暖灯光，超详细湿润细节皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_19',
    name: '#19 G-Whiz Missionary',
    nameZh: 'G-Whiz抬腿传教士变体',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿高高抬到肌肉黑人男性肩膀上G-Whiz姿势，男性用力向下深插粗大黑色阴茎每一下都撞击最深处，女性双手抓床单脸部极度愉悦眼睛翻白尖叫，汗水淋漓动态正面特写+俯视镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和淫水喷溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_20',
    name: '#20 Flatiron Low',
    nameZh: 'Flatiron平躺低后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性完全趴平在床上双腿并拢微微抬臀，肌肉黑人男性从上面压住采取平躺后入，粗大黑色阴茎紧致深插用力抽动，女性脸侧贴床单闷声呻吟身体轻颤，动态俯视+侧面跟随镜头，流畅60fps真实物理运动，电影感柔和卧室灯光，超详细皮肤纹理和挤压液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_21',
    name: '#21 Deep Impact',
    nameZh: 'Deep Impact深插抬腿变体',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺床上双腿被肌肉黑人男性高举过头，粗大黑色阴茎以极深角度猛烈向下抽插到底，女性身体几乎折叠脸部充血极度愉悦尖叫，汗水飞溅淫水被挤压喷出，动态俯视特写+侧面镜头，流畅60fps真实物理运动，电影感柔和卧室灯光，超详细皮肤纹理血管和湿润阴道，硬核激烈性爱8K',
  },

  {
    id: 'pose_22',
    name: '#22 Reverse Prayer',
    nameZh: 'Reverse Prayer反向祈祷式后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪姿双手在背后被肌肉黑人男性抓住像反向祈祷，男性从后面站立猛烈抽插粗大黑色阴茎，女性上身被迫后仰胸部前挺大声呻吟，汗水滴落动态后方环绕镜头+插入特写，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_23',
    name: '#23 Magic Mountain',
    nameZh: 'Magic Mountain魔法山后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性趴在堆起的枕头或靠垫上形成魔法山形状屁股高抬，肌肉黑人男性从后面猛烈撞击粗大黑色阴茎深插，女性脸埋枕头闷声尖叫身体前后摇晃，动态侧面跟随+低角度特写，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和淫水滴落，硬核激烈性爱8K',
  },

  {
    id: 'pose_24',
    name: '#24 Seated Scissors',
    nameZh: 'Seated Scissors坐姿剪刀式',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐姿，苗条年轻女性面对面跨坐一条腿伸直另一条缠腰像坐姿剪刀式，粗大黑色阴茎深插同时互相磨蹭，女性双手环抱脖子亲吻呻吟，动态正面亲密镜头+慢动作特写插入，流畅60fps真实物理，电影感室内灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_25',
    name: '#25 Table Top',
    nameZh: 'Table Top桌面式',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性躺在桌子边缘双腿大张，肌肉黑人男性站立桌边粗大黑色阴茎猛烈抽插，女性双手抓桌边身体随节奏剧烈晃动尖叫，汗水滴在桌面动态侧面+俯视特写镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_26',
    name: '#26 Crab Walk Cowgirl',
    nameZh: 'Crab Walk螃蟹行走式女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺，苗条年轻女性以螃蟹行走姿势双手双脚撑地背对他疯狂上下套弄粗大黑色阴茎，乳房和屁股剧烈晃动，动态低角度特写阴部+侧面镜头，流畅60fps真实物理，电影感卧室灯光，超详细皮肤纹理和淫水四溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_27',
    name: '#27 Superman Suspended',
    nameZh: 'Superman悬空后入',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站立将苗条年轻女性整个身体平行悬空抱起像超人飞姿势，从后面插入粗大黑色阴茎猛烈抽插，女性手臂向前伸展呻吟身体完全被控制，动态侧面全景+特写插入，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和汗水飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_28',
    name: '#28 Pinball Wizard',
    nameZh: 'Pinball Wizard弹球式快速浅插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿抬高，肌肉黑人男性站立以快速浅插+深插交替的弹球节奏抽插粗大黑色阴茎，女性身体随节奏弹动尖叫愉悦，动态正面特写+高速镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_29',
    name: '#29 Corkscrew Spiral',
    nameZh: 'Corkscrew螺旋式侧入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性侧躺一条腿抬起，肌肉黑人男性跪姿以螺旋旋转方式插入粗大黑色阴茎，女性转头呻吟身体轻颤，动态侧面跟随+旋转特写镜头，流畅60fps真实物理运动，电影感温暖灯光，超详细湿润细节皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_30',
    name: '#30 Bridge Raised Hip',
    nameZh: 'Bridge桥式抬臀',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性做桥式抬高臀部和背部，肌肉黑人男性跪姿从上方猛烈向下插入粗大黑色阴茎，女性手臂支撑身体颤抖呻吟，动态侧面+俯视特写镜头，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理和挤压淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_31',
    name: '#31 Doggy Leg Lift Variant',
    nameZh: 'Doggy with Leg Lift后入抬腿变体',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性标准后入跪姿，肌肉黑人男性从后面插入同时抬起她一条腿大幅度深插，女性身体侧倾大声呻吟屁股撞击响亮，动态后方特写+侧面跟随镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理血管和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_32',
    name: '#32 Kneeling Oral to Sex',
    nameZh: 'Kneeling Oral to Sex跪姿口交转插入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪在肌肉黑人男性面前先深喉吞含粗大黑色阴茎口水拉丝，然后转身后入跪姿被猛烈插入，连续动作流畅切换，动态多角度特写+侧面镜头，流畅60fps真实物理，电影感卧室灯光，超详细口水淫水皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_33',
    name: '#33 Wall Press Standing',
    nameZh: 'Wall Press墙壁压入站立',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性将苗条年轻女性正面压在墙上站立插入，一条腿被抬起粗大黑色阴茎用力深插，女性脸贴墙壁呻吟双手撑墙，动态正面+侧面交替镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_34',
    name: '#34 Lotus Bounce',
    nameZh: 'Lotus with Bounce莲花坐姿弹跳',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐姿，苗条年轻女性面对面莲花坐姿双腿缠腰猛烈上下弹跳套弄粗大黑色阴茎，热情接吻乳房贴胸晃动，动态正面亲密+慢动作特写，流畅60fps真实物理，电影感浪漫灯光混合欲望，超详细湿润结合处，硬核激烈性爱8K',
  },

  {
    id: 'pose_35',
    name: '#35 Double Leg Shoulder',
    nameZh: 'Double Leg Over Shoulder双腿肩扛深插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿被肌肉黑人男性扛在双肩上身体折叠，粗大黑色阴茎以极深角度猛烈抽插，女性脸部极度愉悦眼睛翻白连续尖叫，汗水狂流动态俯视特写+侧面镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和淫水喷溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_36',
    name: '#36 Standing Reverse Cowgirl',
    nameZh: 'Standing Reverse Cowgirl站立反向女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性站立，苗条年轻女性背对他双腿缠腰被抱起反向女上位，粗大黑色阴茎向上猛烈抽插，女性双手扶他手臂屁股剧烈上下套弄呻吟，汗水飞溅动态侧面环绕镜头+低角度特写插入，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_37',
    name: '#37 Kneeling Missionary',
    nameZh: 'Kneeling Missionary跪姿传教士',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺床上上半身抬起，肌肉黑人男性跪姿压在她身上粗大黑色阴茎深插，女性双腿缠绕他腰部热情接吻，动态正面亲密镜头+侧面跟随，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_38',
    name: '#38 Pile Driver Enhanced',
    nameZh: 'Pile Driver加强版倒立深插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性身体完全倒立双腿被肌肉黑人男性高举过头，粗大黑色阴茎从上方猛烈向下垂直深插，女性脸部充血尖叫愉悦淫水倒流，动态俯视特写+侧面镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和挤压液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_39',
    name: '#39 Side Saddle Cowgirl',
    nameZh: 'Side Saddle侧鞍式女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺，苗条年轻女性侧身跨坐像侧鞍式单腿弯曲猛烈前后研磨套弄粗大黑色阴茎，乳房晃动呻吟，动态侧面特写+正面镜头，流畅60fps真实物理，电影感卧室灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_40',
    name: '#40 Elevated Doggy',
    nameZh: 'Elevated Doggy抬高后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪在床边或沙发边缘屁股高抬，肌肉黑人男性站立从后面猛烈插入粗大黑色阴茎，撞击声响亮女性身体前后摇晃尖叫，动态侧面跟随+后方特写镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和淫水滴落，硬核激烈性爱8K',
  },

  {
    id: 'pose_41',
    name: '#41 Wrapped Lotus',
    nameZh: 'Wrapped Lotus缠绕莲花',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐姿，苗条年轻女性面对面完全缠绕双腿紧锁腰部猛烈上下套弄粗大黑色阴茎，双手抱头深吻，动态正面亲密+慢动作特写结合处，流畅60fps真实物理，电影感浪漫灯光混合欲望，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_42',
    name: '#42 Standing Full Nelson',
    nameZh: 'Standing Full Nelson站立全尼尔森',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性从后面用手臂锁住苗条年轻女性双腿完全悬空站立全尼尔森姿势，粗大黑色阴茎猛烈向上抽插无法挣脱，女性身体被固定尖叫眼睛翻白，汗水狂流动态正面+环绕镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_43',
    name: '#43 Prone Bone Arch',
    nameZh: 'Prone Bone with Arch趴式拱背变体',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性趴在床上用力拱起背部屁股更高抬起，肌肉黑人男性压在上面粗大黑色阴茎深层猛插，女性脸埋枕头闷声呻吟，动态俯视+侧面特写镜头，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理和挤压淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_44',
    name: '#44 Butterfly Thrust',
    nameZh: 'Butterfly with Thrust床边蝴蝶猛插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性躺在床边双腿高抬呈蝴蝶式，肌肉黑人男性站立床边双手按住大腿粗大黑色阴茎高速猛烈抽插，女性身体剧烈晃动尖叫，动态侧面跟随+插入特写，流畅60fps真实物理运动，电影感卧室灯光，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_45',
    name: '#45 Reverse Spooning',
    nameZh: 'Reverse Spooning反向侧卧',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性侧躺，苗条年轻女性背对他侧卧反向缠腿，粗大黑色阴茎从后面插入缓慢到快速抽插，男性手揉捏乳房亲吻脖子，动态侧面亲密镜头+特写，流畅60fps真实物理，电影感温暖灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_46',
    name: '#46 Chair Reverse Cowgirl',
    nameZh: 'Chair Reverse Cowgirl椅子反向骑乘',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐在椅子上，苗条年轻女性背对他反向跨坐椅子疯狂上下套弄粗大黑色阴茎，屁股撞击大腿声响亮，动态低角度特写+侧面镜头，流畅60fps真实物理运动，电影感室内光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_47',
    name: '#47 Missionary Leg Lock',
    nameZh: 'Missionary with Leg Lock传教士锁腿',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿紧紧锁住肌肉黑人男性腰部，男性压在她身上粗大黑色阴茎深插高速抽动，女性双手抓背尖叫眼神迷离，动态正面亲密镜头+慢动作特写插入，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_48',
    name: '#48 Wall Doggy',
    nameZh: 'Standing Doggy against Wall靠墙站立后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性双手扶墙弯腰翘臀，肌肉黑人男性从后面站立猛烈抽插粗大黑色阴茎，女性身体被撞向前倾呻吟，动态侧面全景+后方特写镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_49',
    name: '#49 Cowgirl Lean Forward',
    nameZh: 'Cowgirl with Lean Forward女上前倾',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺，苗条年轻女性女上位身体前倾双手撑床猛烈前后研磨套弄粗大黑色阴茎，乳房垂下晃动呻吟，动态低角度特写+正面镜头，流畅60fps真实物理，电影感卧室灯光，超详细湿润细节皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_50',
    name: '#50 Ultimate Deep Prone',
    nameZh: 'Ultimate Deep Prone极致趴式深压',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性完全压在苗条年轻女性身上极致趴式，粗大黑色阴茎以最大深度猛烈抽插，女性身体几乎被压扁脸埋床单尖叫颤抖，汗水交融淫水被挤出，动态俯视全身+插入超特写镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_51',
    name: '#51 Standing Lotus',
    nameZh: 'Standing Lotus站立莲花',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站立抱起苗条年轻女性面对面双腿缠腰站立莲花姿势，粗大黑色阴茎完全没入体内上下猛烈套弄，女性手臂环抱脖子热情接吻身体上下起伏，汗水交融动态正面环绕镜头+慢动作特写插入，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和湿润液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_52',
    name: '#52 Desk Missionary',
    nameZh: 'Desk Missionary桌面传教士',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性躺在书桌边缘双腿大张，肌肉黑人男性站立桌边压在她身上粗大黑色阴茎猛烈深插，女性双手抓桌边尖叫身体随节奏晃动，动态侧面跟随+俯视特写镜头，流畅60fps真实物理运动，电影感室内灯光，超详细皮肤纹理和淫水滴落桌面，硬核激烈性爱8K',
  },

  {
    id: 'pose_53',
    name: '#53 Sofa Doggy',
    nameZh: 'Sofa Doggy沙发后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪在沙发上翘臀，肌肉黑人男性从后面站立猛烈抽插粗大黑色阴茎，女性上身趴在沙发靠背大声呻吟屁股撞击响亮，动态侧面全景+后方特写镜头，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理血管和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_54',
    name: '#54 Aerial Fuck',
    nameZh: 'Aerial Fuck空中悬空插入',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性完全抱起苗条年轻女性双腿缠腰悬空站立插入，粗大黑色阴茎用力向上深插，女性手臂环抱脖子尖叫，动态正面环绕镜头+低角度特写，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和汗水飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_55',
    name: '#55 Edge Bed Missionary',
    nameZh: 'Edge of Bed Missionary床边传教士',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性躺在床边双腿抬高，肌肉黑人男性站立床边粗大黑色阴茎猛烈抽插，女性身体随节奏前后摇晃脸部极度愉悦，动态侧面跟随+插入特写镜头，流畅60fps真实物理，电影感卧室灯光，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_56',
    name: '#56 Reverse Standing Doggy',
    nameZh: 'Reverse Standing Doggy反向站立后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性背对肌肉黑人男性弯腰双手扶膝反向站立后入，粗大黑色阴茎从后面猛烈撞击，女性头发晃动大声呻吟，动态后方特写+侧面镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和淫水顺腿流，硬核激烈性爱8K',
  },

  {
    id: 'pose_57',
    name: '#57 Kneeling Reverse Cowgirl',
    nameZh: 'Kneeling Reverse Cowgirl跪姿反向女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性跪姿，苗条年轻女性背对他跪跨猛烈上下套弄粗大黑色阴茎，屁股肉浪狂晃双手撑大腿，动态低角度特写+侧面镜头，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理和液体四溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_58',
    name: '#58 Side by Side Parallel',
    nameZh: 'Side by Side Parallel侧卧平行插入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性与肌肉黑人男性面对面侧卧平行姿势，一条腿抬高粗大黑色阴茎深插同时互相磨蹭，热情接吻双手抚摸，动态侧面亲密镜头+慢动作特写，流畅60fps真实物理运动，电影感温暖灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_59',
    name: '#59 Overhead Press',
    nameZh: 'Overhead Press头顶压入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿被肌肉黑人男性压向头顶几乎折叠，粗大黑色阴茎以极深角度猛烈抽插，女性脸部充血尖叫愉悦，动态俯视特写+侧面镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和淫水喷溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_60',
    name: '#60 Balcony Standing',
    nameZh: 'Balcony Standing阳台站立插入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性双手扶阳台栏杆弯腰，肌肉黑人男性从后面站立猛烈抽插粗大黑色阴茎，户外微风吹拂头发飘动呻吟，动态侧面全景+后方特写镜头，流畅60fps真实物理运动，电影感自然光影，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_61',
    name: '#61 Lap Dance to Fuck',
    nameZh: 'Lap Dance to Fuck膝上舞转插入',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐姿，苗条年轻女性面对面先膝上舞磨蹭然后直接坐下粗大黑色阴茎完全吞没猛烈上下套弄，乳房晃动热情接吻，动态正面亲密+低角度特写，流畅60fps真实物理，电影感室内灯光，超详细湿润结合处皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_62',
    name: '#62 Double Leg Lock',
    nameZh: 'Double Leg Lock双腿锁腰',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿紧紧锁住肌肉黑人男性腰部，男性压在她身上粗大黑色阴茎深插高速抽动，女性双手抓背尖叫眼神迷离，动态正面亲密镜头+慢动作特写插入，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_63',
    name: '#63 Wall Slide',
    nameZh: 'Wall Slide墙壁滑行插入',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性将苗条年轻女性背靠墙壁抱起双腿缠腰，粗大黑色阴茎一边抽插一边身体上下滑行，女性手臂环抱脖子呻吟，动态侧面环绕+特写镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_64',
    name: '#64 Prone Pillow Prop',
    nameZh: 'Prone with Pillow Prop趴式枕头抬高',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性趴在床上腹部垫枕头屁股更高拱起，肌肉黑人男性从上面压住粗大黑色阴茎极深猛插，女性脸埋床单闷声尖叫身体颤抖，动态俯视+侧面特写镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和挤压淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_65',
    name: '#65 Suspended Congress',
    nameZh: 'Ultimate Suspended Congress极致悬空缠绵',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站立完全抱起苗条年轻女性双腿缠腰悬空，粗大黑色阴茎缓慢到猛烈深层抽插，双方贴紧亲吻汗水交融，动态正面环绕镜头+慢动作全身特写，流畅60fps真实物理，电影感浪漫灯光混合欲望，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_66',
    name: '#66 Sideways Cowgirl',
    nameZh: 'Sideways Cowgirl侧身女上骑乘',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺床上，苗条年轻女性侧身跨坐单腿弯曲像侧身女上位猛烈前后研磨套弄粗大黑色阴茎，乳房侧晃呻吟身体扭动，动态侧面特写+低角度镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和湿润液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_67',
    name: '#67 Ottoman Prone',
    nameZh: 'Ottoman Prone脚凳趴式后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性上身趴在脚凳上屁股高抬，肌肉黑人男性从后面站立猛烈抽插粗大黑色阴茎，女性双手抓脚凳边缘尖叫身体前后摇晃，动态侧面跟随+后方特写镜头，流畅60fps真实物理，电影感室内灯光，超详细皮肤纹理血管和淫水滴落，硬核激烈性爱8K',
  },

  {
    id: 'pose_68',
    name: '#68 Mirror Doggy',
    nameZh: 'Mirror Doggy镜子前狗爬式',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪姿面对大镜子翘臀，肌肉黑人男性从后面猛烈撞击粗大黑色阴茎，双方通过镜子眼神对视女性大声呻吟，动态镜中反射+侧面镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_69',
    name: '#69 Bathtub Sitting',
    nameZh: 'Bathtub Sitting浴缸坐姿插入',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐在浴缸边缘，苗条年轻女性面对面跨坐湿身浴缸坐姿粗大黑色阴茎完全没入，热水溅起双方猛烈上下套弄呻吟，动态正面亲密+水花特写镜头，流畅60fps真实物理，电影感湿润灯光，超详细皮肤纹理和混合淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_70',
    name: '#70 Stair Standing',
    nameZh: 'Stair Standing楼梯站立后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性双手扶楼梯栏杆弯腰，肌肉黑人男性从后面站立在低一级猛烈抽插粗大黑色阴茎，女性身体随节奏上下晃动尖叫，动态侧面全景+低角度特写，流畅60fps真实物理运动，电影感自然光影，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_71',
    name: '#71 Window Press',
    nameZh: 'Window Press窗边压入站立',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性将苗条年轻女性正面压在落地窗上站立插入，一条腿被抬起粗大黑色阴茎用力深插，女性双手撑玻璃呻吟，动态侧面环绕+玻璃反射特写镜头，流畅60fps真实物理，电影感城市夜景灯光，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_72',
    name: '#72 Ballerina Lift',
    nameZh: 'Ballerina Lift芭蕾抬腿站立',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性一条腿高抬像芭蕾舞姿势被肌肉黑人男性抱起站立插入，粗大黑色阴茎深插另一腿勉强站立，女性手臂环抱脖子尖叫，动态正面+侧面镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和汗水飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_73',
    name: '#73 Twisted Spoon',
    nameZh: 'Twisted Spoon扭转侧卧插入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性侧躺上身扭转面对肌肉黑人男性，一条腿抬高缠腰粗大黑色阴茎从侧面深插，双方热情接吻互相抚摸，动态侧面亲密+慢动作特写，流畅60fps真实物理，电影感温暖灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_74',
    name: '#74 Elevated Reverse Cowgirl',
    nameZh: 'Elevated Reverse Cowgirl抬高反向女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺床上屁股垫高，苗条年轻女性背对他反向女上位猛烈上下套弄粗大黑色阴茎，角度更深屁股撞击响亮，动态低角度特写+侧面镜头，流畅60fps真实物理运动，电影感卧室灯光，超详细皮肤纹理和淫水四溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_75',
    name: '#75 Kneeling Lotus',
    nameZh: 'Kneeling Lotus跪姿莲花',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性跪坐，苗条年轻女性面对面跪跨双腿缠腰跪姿莲花，粗大黑色阴茎深层研磨上下套弄热情接吻，动态正面亲密+慢动作特写结合处，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

  {
    id: 'pose_76',
    name: '#76 Desk Reverse Cowgirl',
    nameZh: 'Desk Reverse Cowgirl桌面反向骑乘',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐在书桌椅子上，苗条年轻女性背对他反向跨坐桌面边缘疯狂上下套弄粗大黑色阴茎，动态低角度阴部特写+侧面镜头，流畅60fps真实物理运动，电影感室内光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_77',
    name: '#77 Couch Lap Reverse',
    nameZh: 'Couch Lap Reverse沙发膝上反向',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐在沙发上，苗条年轻女性背对他反向跨坐膝上猛烈套弄粗大黑色阴茎，屁股撞击沙发声响亮呻吟，动态后方特写+侧面跟随镜头，流畅60fps真实物理，电影感柔和灯光，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_78',
    name: '#78 Wall Mounted',
    nameZh: 'Wall Mounted墙壁固定悬空',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性将苗条年轻女性背靠墙壁完全固定悬空双腿缠腰，粗大黑色阴茎猛烈抽插无法挣脱，女性尖叫身体颤抖，动态正面环绕+特写镜头，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_79',
    name: '#79 Floor Missionary',
    nameZh: 'Floor Missionary地板传教士',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性躺在地板上双腿大张，肌肉黑人男性压在她身上粗大黑色阴茎深插有力抽动，双方眼神对视热情接吻，动态正面亲密+俯视特写镜头，流畅60fps真实物理，电影感地面视角灯光，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_80',
    name: '#80 Ultimate Yoga Bridge',
    nameZh: 'Ultimate Yoga Bridge极致瑜伽桥式',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性做瑜伽桥式高抬臀部和背部，肌肉黑人男性跪姿从上方猛烈向下插入粗大黑色阴茎，女性手臂支撑身体颤抖尖叫，动态侧面+俯视特写镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和挤压淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_81',
    name: '#81 Standing Split',
    nameZh: 'Standing Split站立劈腿插入',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站立将苗条年轻女性一条腿高高抬起呈劈腿姿势，粗大黑色阴茎从正面猛烈深插，女性另一腿勉强站立手臂环抱脖子尖叫，动态侧面环绕镜头+低角度特写插入，流畅60fps真实物理运动，电影感光影，超详细皮肤纹理和汗水飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_82',
    name: '#82 Rocking Horse',
    nameZh: 'Rocking Horse摇马式女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性仰躺，苗条年轻女性跨坐摇马式前后剧烈摇摆套弄粗大黑色阴茎，双手撑胸乳房晃动呻吟，动态正面低角度+侧面跟随镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和湿润液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_83',
    name: '#83 Viennese Oyster',
    nameZh: 'Viennese Oyster维也纳牡蛎深折',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿被肌肉黑人男性极度折叠压向胸前像牡蛎姿势，粗大黑色阴茎以最大深度猛烈抽插，女性脸部充血极度愉悦连续尖叫，动态俯视特写+侧面镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和淫水喷溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_84',
    name: '#84 Sphinx Prone',
    nameZh: 'Sphinx狮身人面趴式',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性趴姿上身抬起像狮身人面，肌肉黑人男性从后面猛烈撞击粗大黑色阴茎深插，女性手臂支撑胸部前挺大声呻吟，动态侧面全景+后方特写镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理血管和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_85',
    name: '#85 Jellyfish Suspended',
    nameZh: 'Jellyfish水母悬空缠绕',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站立完全抱起苗条年轻女性双腿缠腰像水母悬空，粗大黑色阴茎深层抽插双方身体贴紧缠绵，女性手臂环抱脖子呻吟，动态正面环绕+慢动作特写，流畅60fps真实物理，电影感光影，超详细皮肤纹理和汗水交融，硬核激烈性爱8K',
  },

  {
    id: 'pose_86',
    name: '#86 Tango Standing',
    nameZh: 'Tango探戈式站立缠绵',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性一条腿缠绕肌肉黑人男性腰部像探戈舞姿站立插入，粗大黑色阴茎缓慢到猛烈抽插互相贴紧亲吻，动态侧面亲密+旋转镜头，流畅60fps真实物理运动，电影感浪漫灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_87',
    name: '#87 Fusion Tight',
    nameZh: 'Fusion融合紧密贴合',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐姿，苗条年轻女性面对面完全贴合双腿紧锁融合姿势猛烈上下套弄粗大黑色阴茎，胸部紧贴热情接吻，动态正面超亲密+慢动作特写结合处，流畅60fps真实物理，电影感温暖灯光，超详细皮肤纹理和液体，硬核激烈性爱8K',
  },

  {
    id: 'pose_88',
    name: '#88 Banana Split',
    nameZh: 'Banana Split香蕉劈腿',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性仰躺双腿大张呈香蕉劈腿，肌肉黑人男性跪姿粗大黑色阴茎猛烈深插，女性双手抓床单尖叫身体剧烈晃动，动态俯视特写+侧面镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和淫水滴落，硬核激烈性爱8K',
  },

  {
    id: 'pose_89',
    name: '#89 Octopus Wrap',
    nameZh: 'Octopus章鱼缠绕式',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性双腿和双臂完全缠绕肌肉黑人男性像章鱼，男性坐姿或站立粗大黑色阴茎深插猛烈套弄，动态正面全缠绕+慢动作特写，流畅60fps真实物理，电影感光影，超详细皮肤纹理和汗水，硬核激烈性爱8K',
  },

  {
    id: 'pose_90',
    name: '#90 Throne Cowgirl',
    nameZh: 'Throne宝座坐姿女上',
    prompt: '高精度写实动态4K成人视频，肌肉黑人男性坐在椅子上像宝座，苗条年轻女性面对面跨坐猛烈上下套弄粗大黑色阴茎，双手扶他肩膀乳房剧烈弹跳，动态低角度特写+正面镜头，流畅60fps真实物理运动，电影感室内灯光，超详细湿润细节皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_91',
    name: '#91 Eclipse Back Arch',
    nameZh: 'Eclipse日食遮挡插入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性背对肌肉黑人男性上身后仰像日食姿势，男性从后面插入粗大黑色阴茎双手托住她身体猛烈抽插，动态侧面环绕+特写镜头，流畅60fps真实物理，电影感光影，超详细皮肤纹理和液体飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_92',
    name: '#92 Tidal Wave Rear',
    nameZh: 'Tidal Wave潮汐波浪后入',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性跪姿翘臀像潮汐波浪起伏，肌肉黑人男性从后面猛烈撞击粗大黑色阴茎，女性身体随节奏前后浪动尖叫，动态后方跟随+侧面特写镜头，流畅60fps真实物理运动，电影感柔和灯光，超详细皮肤纹理和淫水，硬核激烈性爱8K',
  },

  {
    id: 'pose_93',
    name: '#93 Phoenix Rising Stand',
    nameZh: 'Phoenix凤凰浴火重生站立',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性站立抱起苗条年轻女性双腿缠腰像凤凰姿势，粗大黑色阴茎猛烈向上抽插，女性头发飘散尖叫身体如浴火，动态正面环绕+低角度特写，流畅60fps真实物理，电影感光影，超详细皮肤纹理和汗水飞溅，硬核激烈性爱8K',
  },

  {
    id: 'pose_94',
    name: '#94 Dragon Wrap Deep',
    nameZh: 'Dragon龙缠绕深插',
    prompt: '高精度写实动态4K成人视频，苗条年轻女性双腿高抬缠绕肌肉黑人男性像龙缠绕，男性压在她身上粗大黑色阴茎极深抽插，双方贴紧呻吟，动态侧面缠绕+慢动作特写，流畅60fps真实物理运动，电影感温暖灯光，超详细湿润皮肤纹理，硬核激烈性爱8K',
  },

  {
    id: 'pose_95',
    name: '#95 Cosmic Floating Intimate',
    nameZh: 'Cosmic宇宙悬浮缠绵',
    prompt: '高精度写实动态4K成人视频，肌肉高大黑人男性完全抱起苗条年轻女性悬空宇宙姿势双腿紧缠，粗大黑色阴茎深层缓慢到猛烈抽插如漂浮，双方眼神交融亲吻，动态正面360环绕+全身慢动作特写，流畅60fps真实物理，电影感梦幻灯光混合欲望，超详细皮肤纹理和湿润细节，硬核激烈性爱8K',
  },

];