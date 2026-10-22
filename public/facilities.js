// The ready-made highlight tags an admin can tick for a listing (Highlights & Facilities).
// One list shared by the admin editor and the public site: `key` is what is stored, the names are shown in each language.
// Font Awesome icon names; to offer another tag, add a line here (keep the list in A-Z order of the English name).
const FACILITIES = [
    { key: '24-hour-security',   en: '24-hour security',    zh: '24小时安保',    icon: 'fa-user-shield' },
    { key: 'basketball-court',   en: 'Basketball court',    zh: '篮球场',        icon: 'fa-basketball' },
    { key: 'bbq',                en: 'BBQ',                 zh: '烧烤区',        icon: 'fa-fire-burner' },
    { key: 'clubhouse',          en: 'Clubhouse',           zh: '会所',          icon: 'fa-people-roof' },
    { key: 'concierge',          en: 'Concierge',           zh: '礼宾服务',      icon: 'fa-bell-concierge' },
    { key: 'covered-parking',    en: 'Covered parking',     zh: '有盖停车位',    icon: 'fa-square-parking' },
    { key: 'direct-mrt',         en: 'Direct MRT access',   zh: '直通 MRT 车站', icon: 'fa-train' },
    { key: 'function-room',      en: 'Function room',       zh: '活动室',        icon: 'fa-champagne-glasses' },
    { key: 'garden',             en: 'Garden',              zh: '花园',          icon: 'fa-tree' },
    { key: 'gym',                en: 'Gym',                 zh: '健身房',        icon: 'fa-dumbbell' },
    { key: 'infinity-pool',      en: 'Infinity pool',       zh: '无边际泳池',    icon: 'fa-person-swimming' },
    { key: 'jogging-track',      en: 'Jogging track',       zh: '慢跑径',        icon: 'fa-person-running' },
    { key: 'mini-market',        en: 'Mini market',         zh: '迷你超市',      icon: 'fa-cart-shopping' },
    { key: 'multi-purpose-hall', en: 'Multi-purpose hall',  zh: '多功能厅',      icon: 'fa-people-roof' },
    { key: 'parking',            en: 'Parking',             zh: '停车位',        icon: 'fa-square-parking' },
    { key: 'perimeter-fencing',  en: 'Perimeter fencing',   zh: '围栏保安',      icon: 'fa-asterisk' },
    { key: 'pet-friendly',       en: 'Pet friendly',        zh: '可养宠物',      icon: 'fa-paw' },
    { key: 'playground',         en: 'Playground',          zh: '儿童游乐场',    icon: 'fa-child-reaching' },
    { key: 'private-lift',       en: 'Private lift',        zh: '私人电梯',      icon: 'fa-elevator' },
    { key: 'reading-room',       en: 'Reading room',        zh: '阅读室',        icon: 'fa-book-open' },
    { key: 'sauna',              en: 'Sauna',               zh: '桑拿',          icon: 'fa-hot-tub-person' },
    { key: 'sky-gym',            en: 'Sky gym',             zh: '高空健身房',    icon: 'fa-dumbbell' },
    { key: 'squash-court',       en: 'Squash court',        zh: '壁球场',        icon: 'fa-table-tennis-paddle-ball' },
    { key: 'steam-bath',         en: 'Steam bath',          zh: '蒸气浴',        icon: 'fa-bath' },
    { key: 'swimming-pool',      en: 'Swimming pool',       zh: '游泳池',        icon: 'fa-person-swimming' },
    { key: 'tennis-court',       en: 'Tennis court',        zh: '网球场',        icon: 'fa-table-tennis-paddle-ball' },
    { key: 'yoga-deck',          en: 'Yoga deck',           zh: '瑜伽平台',      icon: 'fa-spa' }
];
const FACILITY_BY_KEY = Object.fromEntries(FACILITIES.map((f) => [f.key, f]));
