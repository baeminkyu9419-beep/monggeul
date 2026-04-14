// 몽글몽글 — 커뮤니티 봇 (온글 패턴 적용)
// 페르소나 합성 × 시맨틱 뱅크 × 다양성 추적 × 시드 기반 결정론적 생성

// ═══════════════════════════════════════
// 1. 페르소나 합성 시스템 (voice × tone × trait)
// ═══════════════════════════════════════

const VOICES={
  dreamer:    {base:'꿈을 공유하는 친구',   emoji:1},
  analyst:    {base:'해몽을 분석하는 전문가', emoji:0},
  empath:     {base:'감정에 공감하는 위로자', emoji:2},
  curious:    {base:'꿈의 비밀을 탐구하는 탐험가', emoji:1},
  storyteller:{base:'이야기로 풀어내는 서술자', emoji:1},
  humor:      {base:'웃기게 풀어주는 친구', emoji:2},
  mystic:     {base:'신비롭게 해석하는 사람', emoji:1},
  realist:    {base:'현실적으로 조언하는 사람', emoji:0},
};

const TONES={
  casual:  {style:'반말+이모티콘, 친구처럼'},
  warm:    {style:'존댓말+따뜻한 어조'},
  witty:   {style:'유머+가벼운 톤'},
  calm:    {style:'차분+명상적 톤'},
  excited: {style:'감탄+에너지 넘침'},
  sleepy:  {style:'졸린+느긋한 톤'},
  blunt:   {style:'직설적+짧은 문장'},
};

const TRAITS=[
  '자각몽을 자주 꾸는','꿈일기 3년째 쓰는','심리학 전공한',
  '타로도 보는','명상을 즐기는','잠이 많은',
  '새벽형 인간인','직감이 강한','감수성이 풍부한',
  '호기심 많은','공감 능력이 뛰어난','분석적인',
  '간호사인','대학생인','프리랜서인','직장인','고3인',
  'MBTI에 진심인','점 보는 걸 좋아하는','불면증 있는',
  '야근이 잦은','아이 키우는','반려동물 키우는',
  '여행을 좋아하는','독서광인','운동 좋아하는',
  '카페에서 일하는','그림 그리는','음악 하는',
];

// 닉네임 파츠 (조합으로 수천개 생성)
const NICK_PREFIX=['별빛','달빛','새벽','보랏빛','은하수','꿈속','하늘빛','무지개','밤하늘','초승달','구름','안개','여명','황혼','오로라','꿈결','몽글','포근한','반짝이는','고요한','졸린','나른한','잠꾸러기','새벽감성','꽃잠','토끼잠','달그림자','설레는','몽환의','그리운','잔잔한','소복소복','밤산책','꿈꾸는','해질녘','아침이슬','노을빛','봄바람','겨울밤','여름비'];
const NICK_SUFFIX=['탐험가','산책자','여행자','수호자','기록자','해몽사','꿈나비','정원사','독서가','화가','요정','별','고양이','토끼','나비','바람','이슬','꽃잎','소리','물결','일기장','감성러','몽상가','수면왕','해석가','라떼','초코','마카롱','푸딩','캔디','쿠키','구르미','하늘이','봄이','달이팬','드리머'];
const ICONS=['🌙','🌟','💜','🦋','✨','🌸','🌿','☁️','🔮','💫','🧚','🌌','🌈','🐱','🌊','🍀','🕊️','🎨','📖','🐰','🌺','⭐','🦊','🌻','🎭','🧸','🫧','🪄','🌛','🦔','🐝','☕','🍯','🎵','🌷','💤','🧘','🔭','🪷','🌠'];

// ═══════════════════════════════════════
// 2. 시맨틱 뱅크 (꿈 상징 × 해석각도 × 감정 × 상황)
// ═══════════════════════════════════════

const DREAM_BANK={
  '뱀 꿈':{
    symbols:['황금 뱀','검은 뱀','초록 뱀','하얀 뱀','큰 뱀','작은 뱀','뱀 떼'],
    actions:[['손에 감겼어요','감기는'],['허물을 벗고 있었어요','벗는'],['물속에서 헤엄치고 있었어요','헤엄치는'],['집으로 들어왔어요','들어오는'],['나를 가만히 쳐다봤어요','쳐다보는'],['갑자기 사라졌어요','사라지는'],['말을 걸었어요','말을 거는'],['똬리를 틀고 있었어요','틀고 있는'],['나무에 감겨 있었어요','감겨 있는'],['알을 품고 있었어요','품고 있는']],
    feelings:['신비로운','따뜻한','무서운','포근한','경외감','놀라운','평화로운','긴장되는'],
    meanings:['재물운 상승','변화의 시작','지혜의 상징','수호의 기운','무의식의 경고','치유의 시작'],
    badges:[['길몽','재물운'],['길몽'],['길몽','직관']],
    statsRange:{길흉:[70,95],연애운:[40,70],재물운:[80,98],건강운:[55,75],활력:[65,85],직관:[70,95]},
  },
  '추락 꿈':{
    symbols:['고층 빌딩','절벽','다리','엘리베이터','비행기','놀이기구','계단'],
    actions:[['갑자기 떨어졌어요','떨어지는'],['발이 미끄러졌어요','미끄러지는'],['바닥이 무너졌어요','무너지는'],['뛰어내렸어요','뛰어내리는'],['줄이 끊어졌어요','끊어지는'],['밀려서 떨어졌어요','밀려 떨어지는'],['서서히 미끄러졌어요','미끄러지는']],
    feelings:['공포스러운','아찔한','무중력 같은','숨이 막히는','심장이 쿵','식은땀이 나는','체념하는'],
    meanings:['통제력 상실감','변화에 대한 두려움','현실 압박','자신감 저하','새 시작 전 불안'],
    badges:[['흉몽'],['흉몽','건강운']],
    statsRange:{길흉:[10,35],연애운:[25,45],재물운:[20,40],건강운:[20,45],활력:[20,40],직관:[50,70]},
  },
  '이별 꿈':{
    symbols:['전 애인','짝사랑','현재 연인','첫사랑','모르는 이성','친구'],
    actions:[['다시 만났어요','만나는'],['손잡고 걸었어요','걷는'],['떠나갔어요','떠나가는'],['고백받았어요','고백받는'],['편지를 줬어요','편지를 주는'],['뒤돌아봤어요','뒤돌아보는'],['울고 있었어요','우는'],['웃으며 인사했어요','인사하는'],['카페에서 마주쳤어요','마주치는']],
    feelings:['그리운','설레는','아쉬운','허전한','행복한','복잡한','울컥하는','따뜻한'],
    meanings:['미련의 정리','새로운 인연 예고','현재 관계 점검','자기 자신에 대한 그리움','감정의 회복'],
    badges:[['연애운'],['길몽','연애운'],['흉몽','연애운']],
    statsRange:{길흉:[25,80],연애운:[60,95],재물운:[35,55],건강운:[45,65],활력:[40,65],직관:[60,85]},
  },
  '물 꿈':{
    symbols:['맑은 바다','호수','강','폭우','쓰나미','폭포','웅덩이','수영장'],
    actions:[['수영하고 있었어요','수영하는'],['빠졌어요','빠지는'],['건너고 있었어요','건너는'],['비를 맞고 있었어요','비를 맞는'],['물속에서 숨을 쉬었어요','숨쉬는'],['떠다니고 있었어요','떠다니는'],['물 위를 걸었어요','걷는'],['파도에 휩쓸렸어요','휩쓸리는']],
    feelings:['시원한','평화로운','무서운','상쾌한','답답한','자유로운','차가운','포근한'],
    meanings:['감정의 정화','무의식 탐험','변화의 흐름','감정 폭발 전조','치유의 시작','새 출발'],
    badges:[['길몽'],['흉몽'],['길몽','건강운']],
    statsRange:{길흉:[20,85],연애운:[45,70],재물운:[40,65],건강운:[50,85],활력:[45,80],직관:[60,88]},
  },
  '재물 꿈':{
    symbols:['돈다발','금반지','보석','돼지','금붕어','로또','지갑','금괴'],
    actions:[['주웠어요','줍는'],['선물받았어요','선물받는'],['하늘에서 떨어졌어요','떨어지는'],['캤어요','캐는'],['발견했어요','발견하는'],['품에 안았어요','안는'],['쌓여 있었어요','쌓이는'],['빛나고 있었어요','빛나는']],
    feelings:['기쁜','흥분되는','신기한','뿌듯한','꿈같은','황홀한','두근거리는'],
    meanings:['재물운 상승','노력의 보상','기회 포착','풍요의 전조','자기 가치 인정'],
    badges:[['길몽','재물운']],
    statsRange:{길흉:[78,95],연애운:[45,70],재물운:[85,98],건강운:[55,75],활력:[70,88],직관:[65,85]},
  },
  '쫓기는 꿈':{
    symbols:['낯선 사람','괴물','좀비','동물','경찰','그림자','알 수 없는 존재'],
    actions:[['뛰어서 도망갔어요','도망가는'],['숨었어요','숨는'],['다리가 안 움직였어요','안 움직이는'],['문이 안 열렸어요','안 열리는'],['소리가 안 났어요','소리가 안 나는'],['막다른 길에 몰렸어요','몰리는'],['겨우 탈출했어요','탈출하는'],['제자리에서 뛰었어요','제자리에서 뛰는']],
    feelings:['공포','답답함','절박함','무력감','심장이 터질 것 같은','식은땀','초조함'],
    meanings:['현실 압박감','회피하는 문제','스트레스 과부하','직면해야 할 감정','변화 필요 신호'],
    badges:[['흉몽']],
    statsRange:{길흉:[8,25],연애운:[20,40],재물운:[15,35],건강운:[25,45],활력:[15,35],직관:[50,70]},
  },
  '하늘 꿈':{
    symbols:['구름','무지개','별','달','태양','우주','새'],
    actions:[['날았어요','나는'],['떠다니고 있었어요','떠다니는'],['구름 위에 누워 있었어요','눕는'],['별을 만졌어요','만지는'],['하늘을 걸었어요','걷는'],['우주로 갔어요','가는'],['새와 함께 날았어요','함께 나는']],
    feelings:['자유로운','해방감','경이로운','평화로운','감동적인','신성한','벅찬'],
    meanings:['자유에 대한 갈망','목표 달성 전조','정신적 성장','높은 이상','무한한 가능성'],
    badges:[['길몽'],['길몽','활력']],
    statsRange:{길흉:[80,95],연애운:[60,80],재물운:[55,75],건강운:[70,92],활력:[82,98],직관:[75,92]},
  },
  '이빨 꿈':{
    symbols:['앞니','어금니','이빨 전체','송곳니','사랑니'],
    actions:[['빠졌어요','빠지는'],['부서졌어요','부서지는'],['흔들렸어요','흔들리는'],['새로 났어요','새로 나는'],['깨졌어요','깨지는'],['손에 들고 있었어요','들고 있는'],['뱉었어요','뱉는'],['거울에서 봤어요','보는']],
    feelings:['불안한','찝찝한','공포스러운','당황스러운','신기한','걱정되는'],
    meanings:['자존감 동요','변화에 대한 두려움','외모/이미지 걱정','중요한 결정 앞','성장통'],
    badges:[['흉몽'],['흉몽','건강운'],['길몽']],
    statsRange:{길흉:[15,78],연애운:[30,60],재물운:[30,55],건강운:[22,82],활력:[28,75],직관:[55,70]},
  },
  '귀신 꿈':{
    symbols:['하얀 옷 여자','그림자','돌아가신 가족','검은 형체','아이 귀신','익숙한 사람'],
    actions:[['서 있었어요','서 있는'],['다가왔어요','다가오는'],['말을 걸었어요','말을 거는'],['웃고 있었어요','웃는'],['보호해줬어요','보호해주는'],['쫓아왔어요','쫓아오는'],['사라졌어요','사라지는'],['밥을 차려줬어요','차려주는']],
    feelings:['무서운','신비로운','따뜻한','오싹한','그리운','평화로운','공포스러운'],
    meanings:['직면 못한 감정','보호 본능','그리움의 투영','무의식의 경고','과거의 미련','수호의 메시지'],
    badges:[['흉몽'],['길몽'],['길몽','직관']],
    statsRange:{길흉:[10,80],연애운:[25,55],재물운:[25,60],건강운:[20,70],활력:[18,65],직관:[70,95]},
  },
  '시험 꿈':{
    symbols:['시험지','교실','발표','면접','졸업장','성적표','칠판'],
    actions:[['문제가 안 풀렸어요','안 풀리는'],['지각했어요','지각하는'],['준비를 안 했어요','준비 안 한'],['백지를 냈어요','백지를 내는'],['교실을 못 찾았어요','못 찾는'],['합격했어요','합격하는'],['떨어졌어요','떨어지는'],['발표에서 머리가 하얘졌어요','머리가 하얘지는']],
    feelings:['초조한','답답한','허탈한','당황스러운','부끄러운','긴장되는','막막한'],
    meanings:['평가 불안','준비 부족감','과거의 미완성','현재 업무 스트레스','자기 검증 욕구'],
    badges:[['흉몽']],
    statsRange:{길흉:[15,30],연애운:[28,45],재물운:[30,48],건강운:[35,55],활력:[22,40],직관:[45,60]},
  },
  '태몽':{
    symbols:['복숭아','사과','용','금붕어','호랑이','꽃','해','달','보석','무지개'],
    actions:[['땄어요','따는'],['받았어요','받는'],['품에 안았어요','안는'],['하늘에서 내려왔어요','내려오는'],['빛나고 있었어요','빛나는'],['웃고 있었어요','웃는'],['다가왔어요','다가오는'],['선물해줬어요','선물하는']],
    feelings:['신성한','따뜻한','벅찬','행복한','경이로운','감사한','감동적인'],
    meanings:['새 생명의 기운','가족의 확장','큰 인물의 전조','풍요와 축복','소원 성취'],
    badges:[['태몽','길몽']],
    statsRange:{길흉:[85,98],연애운:[70,90],재물운:[72,92],건강운:[82,95],활력:[80,92],직관:[75,88]},
  },
};

// ═══════════════════════════════════════
// 3. 댓글 뱅크 (스타일별 템플릿 조각)
// ═══════════════════════════════════════

const COMMENT_BANK={
  empathy:{
    openers:['저도 비슷한 꿈 꿨어요','와 읽으면서 소름...','이거 완전 공감','맞아요 저도요ㅠ','헉 저만 꾸는 줄 알았는데','완전 똑같은 꿈이에요','오 저랑 비슷한 상황','이런 꿈 꾸는 사람 또 있구나','진짜 공감 100%','아 나도나도','읽다가 멈췄어요','이거 제 얘기인 줄 알았어요'],
    connectors:['깨고 나서도 하루종일 생각났어요','이런 꿈 진짜 생생하면 잊히질 않죠','저번에도 비슷한 거 꾸고 며칠 찝찝했어요','그때 느낌이 아직도 기억나요','잠깐인데도 엄청 길게 느껴지더라고요','다음날까지 기분이 묘했어요','저도 깨고 나서 한참 멍했거든요','그 감정이 하루종일 따라다녀요','누구한테 말하기도 뭐하고 혼자 끙끙했어요'],
    closers:['혼자가 아니었네요','여기서 같은 경험 보니까 반갑다','저만 그런 줄 알았는데 위로돼요','비슷한 사람이 이렇게 많다니','이래서 여기 좋아하게 됐어요','진짜 반갑다 같은 경험 가진 사람'],
  },
  interpret:{
    openers:['달이한테 물어봤는데','할머니가 그러셨는데','찾아보니까','꿈풀이 해보니까','해몽 앱에서 봤는데','유튜브에서 봤는데','엄마가 그러는데','어디서 읽었는데'],
    connectors:['변화의 시기라는 뜻이래요','마음이 뭔가 말하려는 거래요','기회가 오고 있다는 뜻이래요','새로운 시작을 알리는 거래요','마음이 치유되는 과정이래요','에너지가 바뀌는 시기래요','무의식이 정리 중이래요','내면이 성장하고 있다는 신호래요'],
    closers:['달이한테 더 물어보세요!','반복되면 더 중요한 메시지래요','기록해두면 나중에 의미가 보여요','꿈이 다 이유가 있나봐요','한번 깊게 생각해보세요','다음에 또 꾸면 비교해보세요'],
  },
  cheer:{
    openers:['좋은 꿈이네요!','힘든 꿈이었겠다...','괜찮아요!','에이 별거 아니에요','우와 부럽다','고생했어요ㅠ','아이고 무서웠겠다','오 좋은데?!','헉 힘드셨겠다'],
    connectors:['좋은 일이 생길 거예요','금방 지나갈 거예요','좋은 방향으로 가고 있어요','분명 좋아질 거예요','이미 잘하고 있어요','더 좋은 날이 올 거예요','마음이 정리되면 안 꿀 거예요','지금이 제일 힘든 거예요 곧 나아져요'],
    closers:['화이팅!','푹 쉬세요 🌙','좋은 기운 보내요','오늘도 좋은 하루!','응원할게요','따뜻한 차 한 잔 드세요','좋은 꿈 꾸세요 오늘은!','내일은 더 좋을 거예요'],
  },
  experience:{
    openers:['저는 이 꿈 꾸고','비슷한 경험 있는데','작년에 똑같은 꿈 꿨어요','시험 기간에 이 꿈 꿨었는데','이직 전에 이런 꿈 꿨어요','몇 달 전에 저도','고등학교 때 맨날 이 꿈 꿨어요','군대에서 이 꿈 꿨는데','결혼 전에 이런 꿈 꿨었어요','출산 전에 비슷한 꿈 꿨는데'],
    connectors:['진짜 좋은 일 생겼어요','스트레스 줄이니까 안 꿔요','마음 정리가 됐어요','결국 잘 풀렸어요','지나고 보니 맞았어요','좋은 변화가 있었어요','일주일 뒤에 상황이 달라졌어요','이후로 같은 꿈은 안 꿔요','그 시기 지나니까 자연스럽게 없어졌어요'],
    closers:['꿈이 알려준 거였나 봐요','그래서 꿈 기록하게 됐어요','이후로 꿈 해몽 믿어요','참고가 되면 좋겠어요','우연이 아닌 것 같아요','경험담이에요 ㅎㅎ'],
  },
  question:{
    openers:['혹시','근데 궁금한 게','한 가지 궁금한 건데','혹시 기억나세요?','아 진짜 궁금한 게','이거 좀 물어봐도 돼요?'],
    connectors:['색깔이나 분위기가 어땠어요?','전에도 비슷한 꿈 꾼 적 있어요?','깨고 나서 첫 느낌이 뭐였어요?','혼자였어요 아니면 누가 있었어요?','그 전에 무슨 일 있었어요?','그 장면 이후에 뭐가 있었어요?','꿈에서 냄새나 소리 같은 거 기억나요?','시간대가 낮이었어요 밤이었어요?','요즘 스트레스 받는 일 있어요?'],
    closers:['디테일에 따라 해석이 달라져요','맥락이 중요하거든요','기억나면 답글 달아주세요','자세할수록 정확해요','같이 해석해봐요','알려주시면 제가 아는 데까지 해볼게요'],
  },
  relate:{
    openers:['이거 읽으니까','오 이 글 보고','갑자기 생각났는데','아 맞다 저도','이거 보니까 떠오르는 게','신기하게도 저도'],
    connectors:['어젯밤 꿈이 생각나요','예전에 비슷한 거 겪었는데','친구가 똑같은 얘기 했었어요','꿈 관련 책에서 읽은 게 있는데','언니가 이런 꿈 꾸더니','직장 동료가 이런 꿈 꾸고'],
    closers:['연결되는 부분이 있어서 신기해요','꿈이란 게 참 묘해요','사람마다 다르긴 하겠지만요','재미있죠 이런 거','공유해봤어요 ㅎㅎ','혹시 도움이 될까 해서요'],
  },
};

// 완성형 댓글 (조합 아닌 자연스러운 한 줄 — 50종)
const FULL_COMMENTS=[
  '오 이거 저도 꿨어요 대박 ㅋㅋ 진짜 신기하다',
  '읽다가 소름... 어젯밤에 비슷한 꿈 꿨거든요',
  '이런 꿈은 보통 좋은 징조래요! 기대해봐도 될 듯',
  '와 저만 이런 꿈 꾸는 줄 알았는데 위로돼요ㅠ',
  '저는 이 꿈 꾸고 나서 진짜 좋은 일 있었어요',
  '달이한테 해몽 받아보세요! 저도 받고 좀 안심됐어요',
  '꿈일기 쓰기 시작하면 이런 꿈 더 잘 기억나요',
  '이거 스트레스 받을 때 잘 꾸는 꿈이래요 푹 쉬세요',
  '비슷한 꿈 꾸다가 요즘은 안 꿔요 괜찮아질 거예요!',
  '꿈속 감정이 중요하대요 기분이 어땠어요?',
  '공감 누르고 갑니다... 저도 똑같은 경험 ㅠ',
  '이런 꿈은 큰 변화 전에 꾼다는 말이 있더라고요',
  '저도 처음엔 무서웠는데 알고 보면 좋은 꿈이래요',
  '오늘 밤엔 좋은 꿈 꾸세요 🌙',
  '여기 다들 비슷한 꿈 꾸는구나 신기해요',
  '저번 주에 똑같은 꿈 꿔서 바로 공감했어요',
  '꿈 해석 찾아봤는데 전환점이 온다는 뜻이래요',
  '저도 이 꿈 꾸고 로또 샀는데 ㅋㅋ 안 됐어요 ㅋㅋ',
  '힘든 시기에 이런 꿈 많이 꾼대요 힘내세요!',
  '글 읽으면서 제 꿈이 떠올랐어요 기록해둬야겠다',
  '헐 저 오늘 아침에 거의 똑같은 꿈 꿨는데 뭐지',
  '이런 글 보면 꿈이란 게 진짜 신비로워요',
  '댓글 달려다 보니 벌써 공감 많네 ㅋㅋ 다들 같은 경험이구나',
  '저도 새벽에 이런 꿈 꿔서 검색하다가 여기 왔어요',
  '우리 엄마도 이런 꿈 꾸면 기도하라고 하셨어요 ㅋㅋ',
  '근데 이 꿈 꾸면 진짜 며칠 동안 기분이 묘해요',
  '저는 아직도 3년 전에 꾼 비슷한 꿈이 기억나요 신기하게',
  '어쩐지 요즘 잠을 잘 못 자더라니... 비슷한 꿈 꿨어요',
  '이거 보고 나도 꿈 기록 시작해야겠다 싶었어요',
  '와 이렇게 자세하게 기억하시는 거 대단해요',
  '저는 꿈 꿔도 금방 까먹는데ㅠ 기록 습관이 대단하시다',
  '비슷한 꿈 꾸는 사람끼리 모이면 재밌겠다 ㅋㅋ',
  '이 앱 깔고 처음으로 공감 누른 글이에요',
  '아 진짜요? 저도 저번 달에 이 꿈 꿔서 달이한테 물어봤어요',
  '요즘 이런 꿈 자주 꾸는데 계절 탓인가...',
  '꿈꿀 때 자각몽 되면 좋겠는데 맨날 당하고 깨요 ㅋㅋ',
  '이 글 저장해둘게요 나중에 비슷한 꿈 꾸면 비교하려고',
  '고양이 키우는데 고양이도 꿈 꿀까 가끔 궁금해요 ㅋ',
  '이 꿈 해석 유튜브에서도 봤는데 여기가 더 와닿아요',
  '직장 다니면서 이런 꿈 자주 꾸면 번아웃이래요 쉬세요!',
  '우와 글 쓰는 거 보니까 감수성이 풍부하신 분 같아요',
  '읽으면서 막 빨려들어가는 느낌 ㅋㅋ 생생하게 쓰셨네',
  '아 이거 MBTI별로 꾸는 꿈이 다르다는 말도 있더라고요',
  '저도 여기 와서 적기 시작한 지 한 달 됐는데 꿈이 더 선명해졌어요',
  '새벽 감성으로 읽으니까 더 와닿네요',
  '이런 거 보면 무의식이 진짜 있긴 한가 봐요',
  '겁나 공감되는데 이걸 어떻게 말로 설명해야 할지 모르겠음 ㅋㅋ',
  '아아 나만 이런 거 아니었구나 살짝 안심',
  '이 분 글 스타일 너무 좋아요 계속 적어주세요',
  '잠들기 전에 여기 글 읽다가 잠드는 게 취미예요 ㅋㅋ',
];

// ═══════════════════════════════════════
// 4. 시드 기반 유틸리티
// ═══════════════════════════════════════

function seededRandom(seed){
  let s=seed;
  return function(){
    s=(s*16807+0)%2147483647;
    return(s-1)/2147483646;
  };
}
function dateSeed(d){ return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); }

function pickOne(arr,rng){ return arr[Math.floor(rng()*arr.length)]; }
function pickUnique(arr,n,rng){
  const pool=[...arr]; const result=[];
  for(let i=0;i<n&&pool.length>0;i++){
    const idx=Math.floor(rng()*pool.length);
    result.push(pool.splice(idx,1)[0]);
  }
  return result;
}
function randRange(min,max,rng){ return min+Math.floor(rng()*(max-min+1)); }

function formatTimeAgo(min){
  if(min<1)return '방금 전';
  if(min<60)return Math.floor(min)+'분 전';
  const h=Math.floor(min/60);
  if(h<24)return h+'시간 전';
  return Math.floor(h/24)+'일 전';
}

// ═══════════════════════════════════════
// 5. 페르소나 생성 (합성)
// ═══════════════════════════════════════

function generatePersona(rng, usedNicks){
  let nick;
  // 닉네임 중복 방지
  for(let attempt=0;attempt<20;attempt++){
    const prefix=pickOne(NICK_PREFIX,rng);
    const suffix=pickOne(NICK_SUFFIX,rng);
    const sep=rng()>0.5?'_':'';
    nick=prefix+sep+suffix;
    if(!usedNicks.has(nick))break;
  }
  usedNicks.add(nick);

  const voice=pickOne(Object.keys(VOICES),rng);
  const tone=pickOne(Object.keys(TONES),rng);
  const trait=pickOne(TRAITS,rng);
  const icon=pickOne(ICONS,rng);

  return { nick, icon, voice, tone, trait };
}

// ═══════════════════════════════════════
// 6. 글 동적 생성 (뱅크 조합)
// ═══════════════════════════════════════

function composeDreamPost(tag, rng, usedCombos){
  const bank=DREAM_BANK[tag];
  if(!bank)return null;

  // 심볼+액션 조합 중복 방지
  let symbol, action, comboKey;
  for(let i=0;i<30;i++){
    symbol=pickOne(bank.symbols,rng);
    action=pickOne(bank.actions,rng);
    comboKey=symbol+'_'+action[0];
    if(!usedCombos.has(comboKey))break;
  }
  usedCombos.add(comboKey);

  const feeling=pickOne(bank.feelings,rng);
  const feeling2=pickOne(bank.feelings.filter(f=>f!==feeling),rng);
  const meaning=pickOne(bank.meanings,rng);
  const badges=pickOne(bank.badges,rng);

  const acted=action[0];   // 과거형: "손에 감겼어요"
  const acting=action[1];  // ~는형: "감기는"

  // 개인 상황 (페르소나 깊이 — 30종)
  const situations=[
    '요즘 이직 준비하느라 잠을 잘 못 자는데','시험 끝나고 푹 잤더니','여행 가기 전날 밤에',
    '친구랑 통화하다 잠들었는데','야근하고 새벽에 겨우 눕자마자','주말이라 늦잠 자는데',
    '감기 걸려서 약 먹고 잤는데','소개팅 다녀오고 잠들었는데','운동하고 샤워하고 누웠는데',
    '퇴근하고 바로 쓰러져서','비 오는 날이라 일찍 잤는데','카페에서 졸다가',
    '부모님이랑 통화하고 잤는데','이사한 지 얼마 안 돼서 낯선 집에서','명절 연휴에 시골에서',
    '면접 보고 와서 긴장이 풀리니까','넷플 보다가 소파에서 잠들었는데','고양이가 옆에서 자고 있었는데',
    '새벽 3시에 갑자기 깼다가 다시 잠들었는데','아이 재우다가 같이 잠들었는데',
    '카페인 끊은 지 3일째인데 확실히 꿈이 생생해요','낮잠을 좀 잤는데',
    '친구 집에서 자고 왔는데','여자친구랑 전화하다 잠들었는데','배달 음식 시켜먹고 바로 누웠는데',
    '헬스장 갔다 와서 온몸이 풀려서','독서하다가 잠이 들었는데','ASMR 듣다가 잠들었는데',
    '공부하다 책상에서 잠들었는데','영화 보고 와서 감정이 남아있는 채로 잤는데',
  ];
  const situation=pickOne(situations,rng);

  // 후기/감상 (실감나는 마무리 — 30종)
  const afterthoughts=[
    '알람 소리에 겨우 깼는데 아직도 기분이 이상해요','솔직히 무슨 뜻인지 모르겠어서 여기 적어봐요',
    '꿈인 줄 모르고 진짜인 줄 알았어요 ㅋㅋ','이런 꿈 처음이라 기록해둡니다',
    '비슷한 경험 있는 분 있으면 알려주세요ㅠ','깨고 나서 이불 속에서 한 10분 멍때렸어요',
    '아침에 출근하면서도 계속 생각나요','꿈 기록 처음 해보는데 신기하네요',
    '검색해봤는데 해석이 다 달라서 여기 적어봐요','남자친구한테 얘기했더니 웃더라고요',
    '친구한테 말했더니 그것도 꿈이냐고 ㅋㅋ','이거 정말 신기해서 바로 앱 켰어요',
    '꿈일기 쓰기 시작한 지 일주일째인데 점점 생생해져요','이 앱 깔고 처음 적는 꿈이에요',
    '엄마한테 얘기했더니 무슨 좋은 일 생긴다고 하셨어요','화장실 가다가 멈춰서 메모했어요',
    '출근 전에 급하게 적는 중이에요 ㅋㅋ','이불 밖으로 나오기 싫어서 누워서 적어요',
    '여기 적고 나니까 좀 정리되는 느낌이에요','직장 동료한테 말했더니 해몽 해달라고 ㅋㅋ',
    '요즘 꿈을 너무 생생하게 꿔서 무섭기도 해요','달이한테 물어볼까 고민 중이에요',
    '이 꿈 때문에 기분이 하루종일 이상하네요','작년에도 비슷한 꿈 꿨는데 기록 안 해둔 게 아쉬워요',
    '오늘따라 꿈이 유난히 선명했어요','일어나자마자 캡처하듯 기억나서 바로 적어요',
    '꿈 내용 자체는 짧은데 감정이 진짜 강렬했어요','여기 올리는 거 처음인데 다들 따뜻하네요',
  ];
  const afterthought=pickOne(afterthoughts,rng);

  // 제목 패턴 (8종 — 자연스러운 구어체)
  const titlePatterns=[
    ()=>`${getTagEmoji(tag)} ${symbol}이 나오는 ${feeling} 꿈`,
    ()=>`${getTagEmoji(tag)} 꿈에서 ${symbol}이 ${acted.slice(0,-1)}는데...`,
    ()=>`${getTagEmoji(tag)} ${symbol} 꿈 꿨는데 무슨 의미일까요`,
    ()=>`${getTagEmoji(tag)} ${feeling} 꿈이었어요`,
    ()=>`${getTagEmoji(tag)} 이 꿈 나만 꾸나요..?`,
    ()=>`${getTagEmoji(tag)} 생생했던 ${symbol} 꿈 기록`,
    ()=>`${getTagEmoji(tag)} 새벽에 깼는데 ${feeling} 기분이에요`,
    ()=>`${getTagEmoji(tag)} 요즘 자꾸 이런 꿈을 꿔요`,
  ];
  const title=pickOne(titlePatterns,rng)();

  // 본문 패턴 (10종 — 개인 상황 + 구체적 장면 + 후기)
  const bodyPatterns=[
    ()=>`${situation} 꿈에서 ${symbol}이 나왔어요. ${acted} ${feeling} 느낌이었는데 깨고 나서도 그 기분이 계속 남아있었어요. ${afterthought}`,
    ()=>`${situation} 진짜 생생한 꿈 꿨어요. ${symbol}이 ${acting} 장면이었는데 ${feeling} 느낌이랑 ${feeling2} 느낌이 동시에 들었어요. ${afterthought}`,
    ()=>`꿈에서 ${symbol}이 나타났는데 ${acted} 처음엔 ${feeling}했는데 나중에는 오히려 ${feeling2}해졌어요. ${situation} 이런 꿈은 처음이에요. ${afterthought}`,
    ()=>`${situation} 잠들자마자 바로 꿈을 꿨어요. ${symbol}이 있었고 주변 분위기가 되게 ${feeling}했어요. ${acted} 그 장면이 아직도 머릿속에 남아있어요. ${afterthought}`,
    ()=>`완전 신기한 꿈 꿨어요. ${symbol}이 ${acting} 꿈이었는데 현실에서 느껴본 적 없는 ${feeling} 감정이 들었어요. ${afterthought}`,
    ()=>`${situation} ${symbol} 관련 꿈을 꿨어요. ${acted} 되게 ${feeling}한 분위기였는데 잠깐인데도 엄청 길게 느껴졌어요. 이거 혹시 ${meaning}이랑 관련 있나요? ${afterthought}`,
    ()=>`오늘 새벽에 깼는데 심장이 쿵쿵거려요. ${symbol}이 ${acting} 꿈이었거든요. ${feeling} 기분이 아직도 남아있어요. ${afterthought}`,
    ()=>`어젯밤 꿈이 너무 선명해서 적어봐요. ${symbol}이 나왔고 ${acted} 처음엔 ${feeling}했는데 어느 순간 ${feeling2}해지더라고요. ${afterthought}`,
    ()=>`${situation} 꿈 내용이 진짜 생생해요. ${symbol}이 있었는데 ${acted} 분위기는 전체적으로 ${feeling}했어요. 깨자마자 여기 적어요. ${afterthought}`,
    ()=>`이런 꿈 꾸는 사람 저 말고 또 있나요? ${symbol}이 ${acting} 꿈이었는데 ${feeling}면서도 ${feeling2}한 게 진짜 묘했어요. ${situation} 이런 꿈 꿨어요. ${afterthought}`,
  ];
  const body=pickOne(bodyPatterns,rng)();

  // stats 생성
  const sr=bank.statsRange;
  const stats={};
  for(const[k,range]of Object.entries(sr)){
    stats[k]=randRange(range[0],range[1],rng);
  }

  const similarCount=randRange(30,200,rng);
  const similar=`${getTagEmoji(tag)} ${tag} · ${similarCount}명`;

  return { title, body, badges, stats, tag, similar };
}

function getTagEmoji(tag){
  const map={'뱀 꿈':'🐍','추락 꿈':'😰','이별 꿈':'💔','물 꿈':'🌊','재물 꿈':'💰','쫓기는 꿈':'🏃','하늘 꿈':'☁️','이빨 꿈':'🦷','귀신 꿈':'👻','시험 꿈':'📝','태몽':'🍼'};
  return map[tag]||'🌙';
}

// ═══════════════════════════════════════
// 7. 댓글 동적 생성 (뱅크 조합, 중복 방지)
// ═══════════════════════════════════════

function composeComment(rng, usedStyles, usedOpeners){
  // 40% 확률로 완성형 댓글 사용 (더 자연스러움)
  if(rng()<0.4){
    let comment;
    for(let i=0;i<10;i++){
      comment=pickOne(FULL_COMMENTS,rng);
      if(!usedOpeners.has(comment))break;
    }
    usedOpeners.add(comment);
    return comment;
  }

  // 60% 확률로 뱅크 조합
  const allStyles=Object.keys(COMMENT_BANK);
  const available=allStyles.filter(s=>!usedStyles.has(s));
  const style=available.length>0?pickOne(available,rng):pickOne(allStyles,rng);
  usedStyles.add(style);

  const bank=COMMENT_BANK[style];

  let opener;
  for(let i=0;i<10;i++){
    opener=pickOne(bank.openers,rng);
    if(!usedOpeners.has(opener))break;
  }
  usedOpeners.add(opener);

  const connector=pickOne(bank.connectors,rng);
  const closer=pickOne(bank.closers,rng);

  // 댓글 길이 변형
  const length=rng();
  let text;
  if(length<0.35){
    text=opener+' '+connector;
  }else{
    text=opener+'! '+connector+'. '+closer;
  }

  return text;
}

// ═══════════════════════════════════════
// 8. 메인: 일일 포스트 생성
// ═══════════════════════════════════════

export function generateDailyPosts(){
  const now=new Date();
  const currentMin=now.getHours()*60+now.getMinutes();
  const masterSeed=dateSeed(now);
  const rng=seededRandom(masterSeed);

  // 다양성 추적
  const usedNicks=new Set();
  const usedCombos=new Set();  // 심볼+액션 조합
  const usedTags=[];           // 연속 같은 태그 방지

  // 3일치 태그 배분 (중복 최소화)
  const allTags=Object.keys(DREAM_BANK);
  const todayCount=3+Math.floor(rng()*3);      // 3~5
  const yesterdayCount=2+Math.floor(rng()*2);   // 2~3
  const day2Count=1+Math.floor(rng()*2);        // 1~2
  const total=todayCount+yesterdayCount+day2Count;

  // 태그를 중복 최소화하며 배분
  const tagPool=[];
  while(tagPool.length<total){
    const shuffled=pickUnique(allTags,allTags.length,rng);
    tagPool.push(...shuffled);
  }
  const assignedTags=tagPool.slice(0,total);

  const allPosts=[];
  let idBase=10000+masterSeed%10000;

  // ── 오늘 포스트 (최소 1개 보장) ──
  let todayAdded=0;
  for(let i=0;i<todayCount;i++){
    const tag=assignedTags[i];
    const postData=composeDreamPost(tag,rng,usedCombos);
    if(!postData)continue;

    const postMin=Math.floor(rng()*Math.max(currentMin,1));
    // 최소 1개는 반드시 포함
    if(postMin>currentMin&&todayAdded>0)continue;
    const minutesAgo=Math.max(0,currentMin-postMin);

    const persona=generatePersona(rng,usedNicks);
    const post=buildFinalPost(postData,persona,minutesAgo,idBase+i,rng,usedNicks);
    allPosts.push(post);
    todayAdded++;
  }

  // ── 어제 포스트 ──
  for(let i=0;i<yesterdayCount;i++){
    const tag=assignedTags[todayCount+i];
    const postData=composeDreamPost(tag,rng,usedCombos);
    if(!postData)continue;

    const minutesAgo=1440+Math.floor(rng()*1440);
    const persona=generatePersona(rng,usedNicks);
    const post=buildFinalPost(postData,persona,minutesAgo,idBase+100+i,rng,usedNicks);
    allPosts.push(post);
  }

  // ── 그저께 포스트 ──
  for(let i=0;i<day2Count;i++){
    const tag=assignedTags[todayCount+yesterdayCount+i];
    const postData=composeDreamPost(tag,rng,usedCombos);
    if(!postData)continue;

    const minutesAgo=2880+Math.floor(rng()*1440);
    const persona=generatePersona(rng,usedNicks);
    const post=buildFinalPost(postData,persona,minutesAgo,idBase+200+i,rng,usedNicks);
    allPosts.push(post);
  }

  return allPosts;
}

function buildFinalPost(postData,persona,minutesAgo,id,rng,usedNicks){
  const time=formatTimeAgo(minutesAgo);

  // 댓글 1~3개 (스타일+opener 중복 방지)
  const commentCount=1+Math.floor(rng()*3);
  const usedStyles=new Set();
  const usedOpeners=new Set();
  const comments=[];

  for(let ci=0;ci<commentCount;ci++){
    const text=composeComment(rng,usedStyles,usedOpeners);
    const cp=generatePersona(rng,usedNicks);

    // 댓글 시간: 글 이후 3분~3시간 뒤
    const delay=3+Math.floor(rng()*180);
    const cMinAgo=Math.max(0,minutesAgo-delay);

    comments.push({
      av:'a'+(ci+1),
      icon:cp.icon,
      nick:cp.nick,
      text,
      time:formatTimeAgo(cMinAgo)
    });
  }

  const likes=Math.floor(rng()*200)+20;

  return {
    id,
    av:'a'+Math.floor(rng()*15+1),
    icon:persona.icon,
    nick:persona.nick,
    time,
    badges:postData.badges,
    similar:postData.similar,
    title:postData.title,
    body:postData.body,
    stats:postData.stats,
    likes,
    comments,
    tag:postData.tag,
    _isBot:true
  };
}
