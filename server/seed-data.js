// Default content, inserted into MySQL by `npm run db:init` (when the tables are empty)
// and by the admin page's "restore defaults" button.
// Image paths are relative to the site root ("img/..." ships with the site, "uploads/..." are admin uploads).
module.exports = {
    hero: {
        img: "img/banner-main.jpeg"
    },
    properties: [
        {
            id: 1,
            title: { zh: "Pavilion Suites KLCC 奢华公馆", en: "Pavilion Suites KLCC Luxury Residence" },
            type: "rent", // rent or sale
            priceRM: 6800,
            isRentPrice: true,
            areaSqft: 1250,
            beds: { zh: "2 房 2 卫", en: "2 Bed 2 Bath" },
            bedrooms: "2",
            bathrooms: "2",
            area: "KLCC",
            location: { zh: "KLCC 核心区", en: "KLCC Core" },
            address: "Jalan Bukit Bintang, KLCC",
            img: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80",
            status: { zh: "95% 新 · 拎包入住", en: "95% New · Move-in Ready" },
            desc: {
                zh: "直通 Pavilion 购物广场，尊享高空无边际泳池与双峰塔天际线。配备私人电梯，含售后管家代办代缴服务。",
                en: "Direct access to Pavilion shopping mall, with a sky infinity pool and Petronas Towers skyline views. Private lift and concierge after-sales services included."
            }
        },
        {
            id: 2,
            title: { zh: "The Astora @ Mont Kiara 绿荫大邸", en: "The Astora @ Mont Kiara Garden Estate" },
            type: "sale",
            priceRM: 2450000,
            isRentPrice: false,
            areaSqft: 2100,
            beds: { zh: "3+1 房 4 卫", en: "3+1 Bed 4 Bath" },
            bedrooms: "3+1",
            bathrooms: "4",
            area: "Mont Kiara",
            location: { zh: "Mont Kiara", en: "Mont Kiara" },
            address: "Jalan Kiara, Mont Kiara",
            img: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80",
            status: { zh: "极简现代风 · 独家房源", en: "Minimalist Modern · Exclusive" },
            desc: {
                zh: "满家乐名校区顶级豪宅，低密度私密布局，包含 2 个并排车位，紧邻满家乐国际学校与商业街。",
                en: "A top-tier home in Mont Kiara's school district with a low-density private layout, 2 side-by-side parking bays, and close to international schools and the shopping street."
            }
        },
        {
            id: 3,
            title: { zh: "TRX Exchange 106 侧云端尊舍", en: "TRX Exchange 106 Skyline Suite" },
            type: "rent",
            priceRM: 5200,
            isRentPrice: true,
            areaSqft: 850,
            beds: { zh: "1 房 1 卫", en: "1 Bed 1 Bath" },
            bedrooms: "1",
            bathrooms: "1",
            area: "TRX",
            location: { zh: "TRX", en: "TRX" },
            address: "TRX International Financial District",
            img: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
            status: { zh: "全新首次出租", en: "Brand New · First Lease" },
            desc: {
                zh: "吉隆坡国际金融中心核心地段，毗邻 Exchange 106 摩天楼，地下连通 MRT 双轨道站，金融精英首选。",
                en: "In the heart of KL's international financial district beside Exchange 106, with underground links to two MRT lines. Ideal for finance professionals."
            }
        },
        {
            id: 4,
            title: { zh: "Bangsar Peak 隐世半山独立洋房", en: "Bangsar Peak Hillside Private Villa" },
            type: "sale",
            priceRM: 6800000,
            isRentPrice: false,
            areaSqft: 4500,
            beds: { zh: "5 房 6 卫", en: "5 Bed 6 Bath" },
            bedrooms: "5",
            bathrooms: "6",
            area: "Bangsar",
            location: { zh: "Bangsar", en: "Bangsar" },
            address: "Bukit Bandaraya, Bangsar",
            img: "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=800&q=80",
            status: { zh: "私人泳池 · 独立庭院", en: "Private Pool · Own Garden" },
            desc: {
                zh: "Bangsar 传统高尚住宅区，拥有全景市区美景与私人入户花园，独立安保围墙，彰显尊贵身份。",
                en: "In Bangsar's prestigious residential enclave, with panoramic city views, a private entrance garden and a secured perimeter wall."
            }
        }
    ],
    team: [
        {
            id: 1,
            name: "Marcus Chen",
            role: { zh: "KLCC 豪宅交易总监", en: "Director, KLCC Luxury Sales" },
            meta: { zh: "从业 12 年 | 精通中英粤", en: "12 yrs experience | Mandarin, English, Cantonese" },
            img: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=200&q=80"
        },
        {
            id: 2,
            name: "Sarah Lim",
            role: { zh: "Mont Kiara 租管专家", en: "Mont Kiara Leasing Specialist" },
            meta: { zh: "从业 8 年 | 国际业主首选", en: "8 yrs experience | Preferred by international owners" },
            img: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80"
        }
    ]
};
