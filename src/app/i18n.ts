export type Lang = 'ru' | 'en';

const STRINGS = {
  title: { ru: 'Пиксельный пикник', en: 'Pixel Picnic' },
  level: { ru: 'Уровень {n}', en: 'Level {n}' },
  play: { ru: 'Играть', en: 'Play' },
  next: { ru: 'Дальше', en: 'Next' },
  retry: { ru: 'Заново', en: 'Retry' },
  restart: { ru: 'Начать заново', en: 'Restart' },
  resume: { ru: 'Продолжить', en: 'Resume' },
  map: { ru: 'Карта', en: 'Map' },
  toMap: { ru: 'К карте уровней', en: 'Back to the map' },
  leaveLevel: { ru: 'Выйти к карте уровней? Этот уровень начнётся заново.', en: 'Leave for the level map? This level will start over.' },
  leave: { ru: 'Выйти', en: 'Leave' },
  stay: { ru: 'Играть дальше', en: 'Keep playing' },
  newVersion: { ru: 'Вышла новая версия — обновляю…', en: 'A new version is out — reloading…' },
  album: { ru: 'Альбом', en: 'Album' },
  settings: { ru: 'Настройки', en: 'Settings' },
  paused: { ru: 'Пауза', en: 'Paused' },
  hard: { ru: 'Сложный', en: 'Hard' },
  superhard: { ru: 'Очень сложный', en: 'Super hard' },
  hardLevel: { ru: 'Сложный уровень!', en: 'Hard level!' },
  superhardLevel: { ru: 'Очень сложный уровень!', en: 'Super hard level!' },
  win1: { ru: 'Отлично!', en: 'Great!' },
  win2: { ru: 'Великолепно!', en: 'Awesome!' },
  win3: { ru: 'Идеально!', en: 'Perfect!' },
  addedAlbum: { ru: 'Картинка добавлена в альбом', en: 'Picture added to your album' },
  stuckTitle: { ru: 'Колония застряла!', en: 'The colony is stuck!' },
  stuckText: {
    ru: 'Во всех слотах коробки, чьи кубики сейчас недоступны. Используй бустер или начни заново.',
    en: 'Every slot holds a color the ants can’t reach yet. Use a booster or try again.',
  },
  giveUp: { ru: 'Сдаться', en: 'Give up' },
  music: { ru: 'Музыка', en: 'Music' },
  sounds: { ru: 'Звуки', en: 'Sounds' },
  language: { ru: 'Язык', en: 'Language' },
  resetProgress: { ru: 'Сбросить прогресс', en: 'Reset progress' },
  resetConfirm: { ru: 'Точно сбросить весь прогресс?', en: 'Really reset all progress?' },
  credits: { ru: 'Авторы и лицензии', en: 'Credits & licenses' },
  close: { ru: 'Закрыть', en: 'Close' },
  buy: { ru: 'Купить', en: 'Buy' },
  notEnough: { ru: 'Не хватает монет', en: 'Not enough coins' },
  locked: { ru: 'Откроется на уровне {n}', en: 'Unlocks at level {n}' },
  world: { ru: 'Мир {n}', en: 'World {n}' },
  collected: { ru: 'Собрано {a} из {b}', en: 'Collected {a} of {b}' },
  speed: { ru: 'Скорость', en: 'Speed' },
  toastBlocked: { ru: 'Сначала возьми коробку перед ней', en: 'Take the box in front first' },
  toastFrozen: { ru: 'Коробка заморожена — растает через несколько ходов', en: 'Frozen — it thaws after a few taps' },
  toastSlots: { ru: 'Нет свободных слотов', en: 'No free slots' },
  toastLink: { ru: 'Связанные коробки берутся только вместе', en: 'Linked boxes must be taken together' },
  toastNoHint: { ru: 'Отсюда уже не выбраться… Попробуй «Отменить» или «+Слот»', en: 'No way out from here… Try Undo or +Slot' },
  toastGrab: { ru: 'Выбери любую коробку в очереди', en: 'Pick any box in the queue' },
  toastLinkSlots: { ru: 'Для связанных коробок нужно два свободных слота', en: 'Linked boxes need two free slots' },
  levelShort: { ru: 'ур. {n}', en: 'lv {n}' },
  booster_hint: { ru: 'Подсказка', en: 'Hint' },
  booster_undo: { ru: 'Отменить', en: 'Undo' },
  booster_slot: { ru: '+Слот', en: '+Slot' },
  booster_shuffle: { ru: 'Перемешать', en: 'Shuffle' },
  booster_grab: { ru: 'Магнит', en: 'Magnet' },
  boosterDesc_hint: { ru: 'Солвер покажет лучшую следующую коробку.', en: 'The solver shows the best next box.' },
  boosterDesc_undo: { ru: 'Отменяет последний ход.', en: 'Takes back your last move.' },
  boosterDesc_slot: { ru: 'Добавляет ещё один слот до конца уровня.', en: 'Adds one more slot for this level.' },
  boosterDesc_shuffle: { ru: 'Перемешивает очередь так, чтобы уровень можно было пройти.', en: 'Reshuffles the queue into a solvable order.' },
  boosterDesc_grab: { ru: 'Достаёт любую коробку из глубины очереди.', en: 'Pulls any box out of the queue.' },
  newMechanic: { ru: 'Новинка!', en: 'New!' },
  gotIt: { ru: 'Понятно!', en: 'Got it!' },
  tutorial1: { ru: 'Нажми на коробку — муравьи выбегут и съедят кубики своего цвета', en: 'Tap a box — its ants will run out and eat cubes of their color' },
  tutorial2: {
    ru: 'Муравьи заходят в рамку с любой стороны и берут кубик, если к нему есть свободный проход',
    en: 'Ants come into the frame from any side and take a cube if there is a free way to it',
  },
  debug: { ru: 'Режим отладки', en: 'Debug mode' },
  debugHint: { ru: 'Все уровни открыты, видна сложность', en: 'All levels unlocked, difficulty visible' },
  debugLevels: { ru: 'Все уровни', en: 'All levels' },
  autoSolve: { ru: 'Автопрохождение', en: 'Auto-solve' },
  skipLevel: { ru: 'Пропустить уровень', en: 'Skip level' },
  on: { ru: 'Вкл', en: 'On' },
  auto: { ru: 'Авто', en: 'Auto' },
  shop: { ru: 'Магазин', en: 'Shop' },
  shopHouses: { ru: 'Домики', en: 'Houses' },
  shopAnts: { ru: 'Муравьи', en: 'Ants' },
  shopBoxes: { ru: 'Коробки', en: 'Boxes' },
  shopBoosters: { ru: 'Бустеры', en: 'Boosters' },
  wear: { ru: 'Выбрать', en: 'Use' },
  worn: { ru: 'Выбрано', en: 'In use' },
  bought: { ru: 'Куплено!', en: 'Bought!' },
  rewardLevel: { ru: 'Уровень пройден', en: 'Level cleared' },
  rewardHard: { ru: 'Сложный уровень', en: 'Hard level' },
  rewardSuperhard: { ru: 'Очень сложный уровень', en: 'Super hard level' },
  rewardReplay: { ru: 'Повторное прохождение', en: 'Replay' },
  rewardStars: { ru: 'Звёзды', en: 'Stars' },
  rewardFast: { ru: 'Быстро!', en: 'Quick!' },
  nightMode: { ru: 'Ночной режим', en: 'Night mode' },
  off: { ru: 'Выкл', en: 'Off' },
  noSolution: { ru: 'Солвер не нашёл решения из этой позиции', en: 'The solver found no solution from here' },
  tutorial3: { ru: 'Не забивай слоты цветами, до которых муравьям не добраться!', en: 'Don’t fill the slots with colors the ants can’t reach!' },
  mech_hidden_t: { ru: 'Коробки-сюрпризы', en: 'Mystery boxes' },
  mech_hidden_d: {
    ru: 'Цвет коробки с «?» откроется, только когда она окажется первой в своём столбце.',
    en: 'A “?” box reveals its color only when it reaches the front of its column.',
  },
  mech_link_t: { ru: 'Связанные коробки', en: 'Linked boxes' },
  mech_link_d: {
    ru: 'Коробки на цепочке берутся только вместе и занимают два слота.',
    en: 'Chained boxes are taken together and need two free slots.',
  },
  mech_fence_t: { ru: 'Заборчик', en: 'Fence' },
  mech_fence_d: {
    ru: 'Через заборчик муравьи не пролезут — заходить придётся с других сторон рамки.',
    en: 'Ants can’t get past a fence — they have to come in from the other sides of the frame.',
  },
  mech_frozen_t: { ru: 'Лёд', en: 'Ice' },
  mech_frozen_d: {
    ru: 'Замороженную коробку нельзя взять. Число на льду — сколько ходов осталось до оттаивания.',
    en: 'A frozen box can’t be taken. The number shows how many taps until it thaws.',
  },
  mech_gate_t: { ru: 'Калитка', en: 'Gate' },
  mech_gate_d: {
    ru: 'В заборе есть калитка с оранжевыми столбиками — муравьи пройдут только через неё.',
    en: 'The fence has a gate between orange-topped posts — that’s the only way in.',
  },
  boosterUnlocked: { ru: 'Новый бустер!', en: 'New booster!' },
  free: { ru: 'бесплатно ×{n}', en: '×{n} free' },
  endless: { ru: 'Бесконечный режим', en: 'Endless mode' },
  loading: { ru: 'Муравьи готовятся…', en: 'Ants are getting ready…' },
  progress: { ru: 'Съедено', en: 'Eaten' },
  creditPictures: { ru: 'Эмодзи для картинок уровней', en: 'Emoji for level pictures' },
  creditTools: { ru: 'Шрифт и 3D', en: 'Font & 3D' },
  creditTwemoji: { ru: '© Twitter, Inc. и участники', en: '© Twitter, Inc. and contributors' },
  creditAudio: { ru: 'Музыка и звуки', en: 'Music & sounds' },
  creditAudioNote: { ru: 'Синтезируются в браузере.', en: 'Synthesized in the browser.' },
} satisfies Record<string, Record<Lang, string>>;

export type StrKey = keyof typeof STRINGS;

let lang: Lang = (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

export function t(key: StrKey, params?: Record<string, string | number>): string {
  let s: string = STRINGS[key][lang];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function loc(v: { en: string; ru: string } | undefined): string {
  return v ? v[lang] : '';
}
