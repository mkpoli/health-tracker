// How to take each measurement, following the published protocols so a value
// recorded at home is comparable with one taken in a clinic.
//
// Sources:
//   WHO STEPS Surveillance Manual, Part 3 Section 3 (waist and hip)
//   WHO, Waist Circumference and Waist-Hip Ratio: Report of a WHO Expert
//     Consultation (2008)
//   NHANES Anthropometry Procedures Manual (CDC) — standing height, weight,
//     neck, upper arm, thigh, calf
//   ISAK International Standards for Anthropometric Assessment — girth sites
//   Japan Society for the Study of Obesity, metabolic syndrome criteria (2005)
//     — umbilical-level abdominal girth
//   American Heart Association, Recommendations for Blood Pressure Measurement
//     in Humans (Pickering et al., Hypertension 2005)
//
// Long-form content rather than interface strings, so it lives here instead of
// the message catalog.

export type GuideLocale = 'en' | 'ja' | 'zh-HanS';

export type MeasurementGuide = {
  /** Site id handed to the 3D model. */
  site: string;
  steps: string[];
  tips: string[];
  mistakes: string[];
  source: string;
};

type GuideByLocale = Record<GuideLocale, MeasurementGuide>;

function guide(
  site: string,
  source: string,
  content: Record<GuideLocale, { steps: string[]; tips: string[]; mistakes: string[] }>,
): GuideByLocale {
  return {
    en: { site, source, ...content.en },
    ja: { site, source, ...content.ja },
    'zh-HanS': { site, source, ...content['zh-HanS'] },
  };
}

export const MEASUREMENT_GUIDES: Record<string, GuideByLocale> = {
  height: guide('height', 'NHANES Anthropometry Procedures Manual', {
    en: {
      steps: [
        'Take your shoes off and stand with your back to a wall, on a hard floor.',
        'Put your heels, buttocks and shoulder blades against the wall, feet together.',
        'Look straight ahead so the line from your ear canal to the bottom of your eye socket is level.',
        'Breathe in, hold, and have someone mark the wall at the highest point of your head with a flat object.',
        'Measure from the floor to the mark.',
      ],
      tips: [
        'Measure at the same time of day — you are up to 2 cm taller in the morning than at night.',
        'A book or a ruler held flat against the wall is more accurate than a tape held over your head.',
      ],
      mistakes: [
        'Standing on carpet, which compresses under your heels.',
        'Tilting the chin up, which adds height that is not there.',
      ],
    },
    ja: {
      steps: [
        '靴を脱ぎ、硬い床の上で壁を背にして立ちます。',
        'かかと・お尻・肩甲骨を壁につけ、足をそろえます。',
        '外耳孔と眼窩下縁を結ぶ線が水平になるよう、まっすぐ前を見ます。',
        '息を吸って止め、頭頂の最も高い位置に平らなものを当てて壁に印をつけてもらいます。',
        '床から印までを測ります。',
      ],
      tips: [
        '毎回同じ時間帯に測ります。朝と夜では最大2cmほど変わります。',
        '頭の上にメジャーを回すより、本や定規を壁に平らに当てるほうが正確です。',
      ],
      mistakes: ['かかとが沈むカーペットの上で測る。', 'あごを上げてしまい、実際より高く出る。'],
    },
    'zh-HanS': {
      steps: [
        '脱鞋，在硬质地面上背靠墙站立。',
        '让足跟、臀部与肩胛骨贴住墙面，双脚并拢。',
        '目视正前方，使外耳道与眼眶下缘的连线保持水平。',
        '吸气屏住，请他人用平直物体抵住头顶最高点，在墙上做标记。',
        '测量地面到标记的距离。',
      ],
      tips: ['每次在同一时段测量，早晚身高可相差约2cm。', '将书本或直尺平贴墙面，比在头顶绕软尺更准确。'],
      mistakes: ['站在会被足跟压陷的地毯上测量。', '抬起下巴，导致读数偏高。'],
    },
  }),

  'body-weight': guide('none', 'NHANES Anthropometry Procedures Manual', {
    en: {
      steps: [
        'Put the scale on a hard, level floor — not carpet.',
        'Weigh yourself first thing in the morning, after using the bathroom and before eating or drinking.',
        'Wear the same amount of clothing each time, or none.',
        'Stand still with your weight evenly on both feet until the reading settles.',
      ],
      tips: [
        'Day-to-day swings of 1-2 kg are water, not fat. The trend over weeks is the signal.',
        'Keep the scale in one place; moving it between floors changes the reading.',
      ],
      mistakes: ['Weighing at different times of day and comparing the numbers.', 'Leaning on a wall or a basin.'],
    },
    ja: {
      steps: [
        '体重計はカーペットではなく、硬く水平な床に置きます。',
        '起床後、排尿を済ませ、飲食の前に測ります。',
        '毎回同じ程度の服装、または何も着ない状態で測ります。',
        '両足に均等に体重をかけ、表示が安定するまで静止します。',
      ],
      tips: [
        '1〜2kgの日々の変動は水分であり、脂肪ではありません。数週間の傾向を見ます。',
        '体重計は同じ場所に置きます。床が変わると値も変わります。',
      ],
      mistakes: ['測る時間帯がばらばらのまま数値を比べる。', '壁や洗面台に寄りかかる。'],
    },
    'zh-HanS': {
      steps: [
        '将体重秤放在坚硬平整的地面上，不要放在地毯上。',
        '晨起排尿后、进食饮水前测量。',
        '每次穿着相同厚度的衣物，或不穿衣物。',
        '双脚均匀受力站稳，待读数稳定。',
      ],
      tips: ['每日1〜2kg的波动是水分而非脂肪，应看数周的趋势。', '体重秤固定放在一处，换地面会改变读数。'],
      mistakes: ['在不同时段测量后互相比较。', '倚靠墙面或洗手台。'],
    },
  }),

  'waist-circumference': guide('waist', 'WHO STEPS Surveillance Manual; WHO Expert Consultation (2008)', {
    en: {
      steps: [
        'Stand with your feet about hip-width apart and your arms relaxed at your sides.',
        'Find the bottom of your lowest rib and the top of your hip bone on one side.',
        'Put the tape around you at the midpoint between those two landmarks.',
        'Check the tape is horizontal all the way around and lies flat against the skin.',
        'Breathe out normally and read the tape at the end of that breath.',
      ],
      tips: [
        'Measure against bare skin, or one thin layer at most.',
        'The tape should sit snug without pressing into the skin — it should not leave a mark.',
        'Take it twice; if the two readings differ by more than 1 cm, take a third.',
      ],
      mistakes: [
        'Measuring at the navel instead of the rib-to-hip midpoint — that is a different measurement, recorded here as Abdominal Circumference.',
        'Holding your stomach in, or measuring after a large meal.',
        'Letting the tape ride up at the back.',
      ],
    },
    ja: {
      steps: [
        '足を腰幅に開いて立ち、腕は自然に下ろします。',
        '片側の最下肋骨の下端と腸骨稜の上端を確認します。',
        'その2点の中間の高さにメジャーを回します。',
        'メジャーが一周水平で、肌に平らに沿っていることを確認します。',
        '普通に息を吐き、吐き終わりで読み取ります。',
      ],
      tips: [
        '素肌、または薄手1枚までの上から測ります。',
        '締めつけず、跡が残らない程度に沿わせます。',
        '2回測り、1cm以上差があれば3回目を測ります。',
      ],
      mistakes: [
        'へその高さで測る（それは別の項目で、ここでは腹囲として記録します）。',
        'お腹を引っ込める、または食後すぐに測る。',
        '背中側でメジャーがずり上がる。',
      ],
    },
    'zh-HanS': {
      steps: [
        '双脚与髋同宽站立，双臂自然下垂。',
        '找到一侧最下肋骨下缘与髂嵴上缘。',
        '在两点连线中点的高度绕软尺一周。',
        '确认软尺整圈水平，并平贴皮肤。',
        '正常呼气，在呼气末读数。',
      ],
      tips: ['贴身测量，最多隔一层薄衣。', '软尺贴合但不勒紧，不应在皮肤上留下压痕。', '测量两次，若相差超过1cm再测第三次。'],
      mistakes: ['在脐部高度测量（那是另一项，本应用记为腹围）。', '收腹，或饱餐后立即测量。', '软尺在背侧上滑。'],
    },
  }),

  'abdominal-circumference': guide('abdomen', 'Japan Society for the Study of Obesity, metabolic syndrome criteria (2005)', {
    en: {
      steps: [
        'Stand relaxed with your feet together and arms at your sides.',
        'Put the tape around your abdomen at the level of your navel.',
        'Keep the tape horizontal all the way around.',
        'Breathe out normally and read at the end of that breath.',
      ],
      tips: [
        'This is the measurement Japanese health checkups use, with 85 cm for men and 90 cm for women as the metabolic-syndrome threshold.',
        'If your abdomen hangs below the navel, the standard still says navel level.',
      ],
      mistakes: ['Pulling the tape tight enough to indent the skin.', 'Holding your breath in, which flattens the abdomen.'],
    },
    ja: {
      steps: [
        '足をそろえて立ち、腕は体側に下ろして力を抜きます。',
        'へその高さで腹部にメジャーを回します。',
        'メジャーが一周水平になるようにします。',
        '普通に息を吐き、吐き終わりで読み取ります。',
      ],
      tips: [
        '特定健診で用いられる測り方で、男性85cm・女性90cmがメタボリックシンドロームの基準値です。',
        '腹部がへそより下垂している場合も、基準はへその高さです。',
      ],
      mistakes: ['肌がへこむほどメジャーを締める。', '息を止めてお腹を平らにする。'],
    },
    'zh-HanS': {
      steps: ['双脚并拢站立，双臂自然下垂放松。', '在脐部水平绕腹部一周。', '保持软尺整圈水平。', '正常呼气，在呼气末读数。'],
      tips: [
        '这是日本健康体检采用的测法，男性85cm、女性90cm为代谢综合征判定值。',
        '腹部下垂低于脐部时，仍以脐部水平为准。',
      ],
      mistakes: ['软尺勒紧到皮肤凹陷。', '憋气使腹部变平。'],
    },
  }),

  'hip-circumference': guide('hip', 'WHO STEPS Surveillance Manual', {
    en: {
      steps: [
        'Stand with your feet together and your weight even on both feet.',
        'Wear thin underwear or nothing — trousers change this measurement.',
        'Put the tape around the widest part of your buttocks.',
        'Check the tape is horizontal by looking in a mirror from the side.',
        'Read without compressing the skin.',
      ],
      tips: ['Move the tape up and down a few centimetres and keep the largest reading.'],
      mistakes: ['Measuring at the hip bones rather than the widest point.', 'Standing with feet apart, which narrows the reading.'],
    },
    ja: {
      steps: [
        '足をそろえ、両足に均等に体重をかけて立ちます。',
        '薄い下着のみ、または何も着けずに測ります。ズボンでは値が変わります。',
        '臀部の最も広い位置にメジャーを回します。',
        '横から鏡を見て、メジャーが水平か確認します。',
        '肌を圧迫せずに読み取ります。',
      ],
      tips: ['メジャーを数cm上下させ、最も大きい値を採用します。'],
      mistakes: ['最も広い位置ではなく腰骨の高さで測る。', '足を開いて立ち、値が小さく出る。'],
    },
    'zh-HanS': {
      steps: [
        '双脚并拢站立，两脚均匀受力。',
        '穿薄内衣或不穿，长裤会改变读数。',
        '在臀部最宽处绕软尺一周。',
        '从侧面照镜子确认软尺水平。',
        '不压迫皮肤地读数。',
      ],
      tips: ['将软尺上下移动数厘米，取最大读数。'],
      mistakes: ['在髋骨高度而非最宽处测量。', '双脚分开站立，导致读数偏小。'],
    },
  }),

  'bust-circumference': guide('bust', 'JIS L 4006 foundation sizing', {
    en: {
      steps: [
        'Wear a non-padded bra that fits, or no bra, and stand upright.',
        'Put the tape around the fullest part of your bust, level with the nipples.',
        'Keep the tape horizontal across your back — a mirror helps.',
        'Breathe out normally and read without compressing the tissue.',
      ],
      tips: [
        'Measure this together with your underbust: the difference between the two is what decides cup size.',
        'A padded or minimising bra changes this number by a full cup or more.',
      ],
      mistakes: ['Letting the tape sag at the back.', 'Pulling tight enough to flatten the breast tissue.'],
    },
    ja: {
      steps: [
        'パッドの入っていない合ったブラを着けるか、何も着けずにまっすぐ立ちます。',
        'バストの最も高い位置、乳頭の高さでメジャーを回します。',
        '背中側で水平になるようにします。鏡を使うと確認しやすいです。',
        '普通に息を吐き、胸を圧迫せずに読み取ります。',
      ],
      tips: [
        'アンダーバストと合わせて測ります。2つの差がカップサイズを決めます。',
        'パッド入りや小さく見せるブラでは、1カップ以上変わります。',
      ],
      mistakes: ['背中側でメジャーが下がる。', '胸がつぶれるほど強く締める。'],
    },
    'zh-HanS': {
      steps: [
        '穿无衬垫且合身的内衣或不穿，保持站直。',
        '在胸部最丰满处、与乳头齐平绕软尺一周。',
        '保持背侧水平，可借助镜子确认。',
        '正常呼气，不压迫组织地读数。',
      ],
      tips: ['与下胸围一同测量：两者之差决定罩杯尺码。', '有衬垫或收束型内衣会使读数相差一个罩杯以上。'],
      mistakes: ['软尺在背侧下垂。', '勒得过紧压平胸部组织。'],
    },
  }),

  'underbust-circumference': guide('underbust', 'JIS L 4006 foundation sizing', {
    en: {
      steps: [
        'Put the tape directly under your breasts, against the ribcage.',
        'Keep it horizontal all the way around.',
        'Pull it snug — firmer than the bust measurement, since this one sits on bone.',
        'Breathe out normally and read.',
      ],
      tips: ['This becomes the band size, rounded to the nearest 5 cm in Japanese sizing.'],
      mistakes: ['Measuring over the breast tissue rather than under it.', 'Leaving the tape loose, which oversizes the band.'],
    },
    ja: {
      steps: [
        'バストのすぐ下、肋骨に沿ってメジャーを当てます。',
        '一周水平になるようにします。',
        'トップバストより少し強めに、骨に沿わせて締めます。',
        '普通に息を吐いて読み取ります。',
      ],
      tips: ['この値が、日本のサイズ表記では5cm刻みに丸めたアンダーの号数になります。'],
      mistakes: ['胸の下ではなく胸の上で測る。', 'ゆるく当てて、号数が大きく出る。'],
    },
    'zh-HanS': {
      steps: ['将软尺紧贴乳房下缘、沿肋骨放置。', '保持整圈水平。', '比上胸围稍紧，贴住骨骼。', '正常呼气后读数。'],
      tips: ['该值在日本尺码中按5cm取整，即为下胸围号数。'],
      mistakes: ['在乳房组织上而非其下方测量。', '软尺过松，导致号数偏大。'],
    },
  }),

  'neck-circumference': guide('neck', 'NHANES Anthropometry Procedures Manual', {
    en: {
      steps: [
        'Sit or stand upright, looking straight ahead with your shoulders relaxed.',
        'Put the tape around your neck just below the larynx.',
        'Keep it horizontal and level; on men it sits just below the Adam apple.',
        'Read without pressing into the skin.',
      ],
      tips: ['Keep your jaw level — tilting the head changes the reading.'],
      mistakes: ['Measuring over a collar.', 'Tensing the neck muscles.'],
    },
    ja: {
      steps: [
        '肩の力を抜き、まっすぐ前を見て座るか立ちます。',
        '喉頭のすぐ下で首にメジャーを回します。',
        '水平を保ちます。男性では喉仏のすぐ下になります。',
        '肌を押さえつけずに読み取ります。',
      ],
      tips: ['あごの高さを保ちます。頭を傾けると値が変わります。'],
      mistakes: ['襟の上から測る。', '首に力を入れる。'],
    },
    'zh-HanS': {
      steps: ['放松肩部、目视前方，坐姿或站姿均可。', '在喉结下方绕颈一周。', '保持水平；男性位于喉结正下方。', '不压迫皮肤地读数。'],
      tips: ['保持下颌水平，头部倾斜会改变读数。'],
      mistakes: ['隔着衣领测量。', '颈部肌肉紧张。'],
    },
  }),

  'thigh-circumference': guide('thigh', 'ISAK International Standards for Anthropometric Assessment', {
    en: {
      steps: [
        'Stand with your weight evenly on both feet, legs slightly apart.',
        'Put the tape around the thigh just below the gluteal fold — the crease where your buttock meets your thigh.',
        'Keep it horizontal and perpendicular to the long axis of the thigh.',
        'Read without compressing the muscle.',
      ],
      tips: ['Measure the same leg every time and record which one — left and right differ.'],
      mistakes: ['Shifting your weight onto one leg, which changes both thighs.', 'Measuring mid-thigh one time and high-thigh the next.'],
    },
    ja: {
      steps: [
        '両足に均等に体重をかけ、脚を軽く開いて立ちます。',
        '殿溝（お尻と太ももの境目のしわ）のすぐ下で大腿にメジャーを回します。',
        '大腿の長軸に対して垂直、かつ水平に保ちます。',
        '筋肉を圧迫せずに読み取ります。',
      ],
      tips: ['毎回同じ側の脚を測り、左右どちらかを記録します。左右で差があります。'],
      mistakes: ['片脚に体重をかけ、両脚の値が変わる。', '毎回違う高さで測る。'],
    },
    'zh-HanS': {
      steps: [
        '两脚均匀受力，双腿略分开站立。',
        '在臀纹（臀部与大腿交界的褶皱）下缘绕大腿一周。',
        '保持与大腿长轴垂直且水平。',
        '不压迫肌肉地读数。',
      ],
      tips: ['每次测量同一条腿并记录左右，两侧存在差异。'],
      mistakes: ['重心偏向一侧腿，改变两腿读数。', '每次测量高度不一致。'],
    },
  }),

  'upper-arm-circumference': guide('upper-arm', 'NHANES Anthropometry Procedures Manual', {
    en: {
      steps: [
        'Let the arm hang relaxed at your side, palm facing your thigh.',
        'Find the midpoint between the tip of your shoulder and the point of your elbow.',
        'Put the tape around the arm at that midpoint.',
        'Keep it horizontal and read without denting the skin.',
      ],
      tips: ['Relaxed and flexed are different measurements — this app records both separately.'],
      mistakes: ['Flexing while measuring the relaxed girth.', 'Measuring at the widest point instead of the marked midpoint.'],
    },
    ja: {
      steps: [
        '腕を体側に下ろし、手のひらを太ももに向けて力を抜きます。',
        '肩先と肘先の中間点を確認します。',
        'その中間点で腕にメジャーを回します。',
        '水平を保ち、肌がへこまない程度で読み取ります。',
      ],
      tips: ['力を抜いた状態と力こぶを作った状態は別の項目です。両方を分けて記録できます。'],
      mistakes: ['安静時の値を測るときに力を入れる。', '中間点ではなく最も太い位置で測る。'],
    },
    'zh-HanS': {
      steps: ['手臂自然下垂，掌心朝向大腿。', '找到肩峰与肘尖的中点。', '在该中点绕上臂一周。', '保持水平，不压陷皮肤地读数。'],
      tips: ['放松与屈肘用力是两项不同的测量，本应用分别记录。'],
      mistakes: ['测量放松围度时用力。', '在最粗处而非标定中点测量。'],
    },
  }),

  'systolic-blood-pressure': guide('upper-arm', 'AHA Recommendations for Blood Pressure Measurement (Hypertension 2005)', {
    en: {
      steps: [
        'Sit quietly for five minutes first, back supported, legs uncrossed, feet flat on the floor.',
        'Rest your arm on a table so the cuff is level with your heart.',
        'Put the cuff on bare skin, its lower edge about 2-3 cm above the elbow crease.',
        'Stay still and do not talk during the measurement.',
        'Take two readings a minute apart and record the average.',
      ],
      tips: [
        'Avoid caffeine, smoking and exercise for 30 minutes beforehand, and empty your bladder first.',
        'Use the same arm each time and note which one — a difference between arms is normal.',
        'A cuff that is too small reads high. The bladder should wrap about 80% of your upper arm.',
      ],
      mistakes: [
        'Measuring straight after walking in, or while talking.',
        'Letting the arm hang below heart level, which raises the reading.',
        'Crossing the legs or sitting without back support.',
      ],
    },
    ja: {
      steps: [
        'まず5分間安静に座ります。背もたれに寄りかかり、脚は組まず、足裏を床につけます。',
        'カフが心臓の高さになるよう、腕を机に置きます。',
        '素肌にカフを巻き、下端を肘のしわの2〜3cm上にします。',
        '測定中は動かず、話さないようにします。',
        '1分あけて2回測り、平均を記録します。',
      ],
      tips: [
        '測定前30分はカフェイン・喫煙・運動を避け、排尿を済ませます。',
        '毎回同じ腕で測り、左右どちらかを記録します。左右差があるのは正常です。',
        'カフが小さいと高く出ます。上腕の約80%を覆う幅が必要です。',
      ],
      mistakes: ['入室直後や会話中に測る。', '腕が心臓より下がり、値が高く出る。', '脚を組む、背もたれを使わずに座る。'],
    },
    'zh-HanS': {
      steps: [
        '先安静坐位休息5分钟，背部有支撑，双腿不交叉，双脚平放地面。',
        '手臂放于桌面，使袖带与心脏齐平。',
        '袖带缚于裸露上臂，下缘距肘窝约2〜3cm。',
        '测量过程中保持静止，不要说话。',
        '间隔1分钟测量两次，记录平均值。',
      ],
      tips: [
        '测量前30分钟避免咖啡因、吸烟与运动，并先排空膀胱。',
        '每次使用同一侧手臂并记录，双臂存在差异属正常。',
        '袖带过小会使读数偏高，气囊应环绕上臂约80%。',
      ],
      mistakes: ['刚走进房间即测量，或测量时说话。', '手臂低于心脏水平，使读数升高。', '交叉双腿或坐姿无背部支撑。'],
    },
  }),
};

export function getMeasurementGuide(metricKey: string, locale: string): MeasurementGuide | null {
  const entry = MEASUREMENT_GUIDES[metricKey];
  if (!entry) return null;

  const key: GuideLocale = locale === 'ja' ? 'ja' : locale === 'zh-HanS' ? 'zh-HanS' : 'en';
  return entry[key];
}

export function hasMeasurementGuide(metricKey: string) {
  return Boolean(MEASUREMENT_GUIDES[metricKey]);
}
