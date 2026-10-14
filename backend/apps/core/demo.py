"""Rich demo dataset (spec acceptance scenarios represented as data).

Everything goes through the real services — no fabricated state transitions.
Banner images are generated with Pillow into MEDIA_ROOT so /media/... URLs work.

The dataset imitates real Tashkent street advertising: local business naming
(UZ/RU mix), real districts and streets, realistic UZS pricing, and promo
banners with the «РЕКЛАМА» marking required on ads in Uzbekistan.
"""

import hashlib
import random
import re
import string
import uuid
from datetime import timedelta

from django.contrib.gis.geos import Point
from django.core.files.storage import default_storage
from django.utils import timezone


def _biz(name, slug, category, phone, description, headline, body, branches):
    """branches: [(label, address, lon, lat), ...]"""
    return {
        "name": name,
        "slug": slug,
        "category": category,
        "phone": phone,
        "description": description,
        "headline": headline,
        "body": body,
        "branches": branches,
    }


# Coordinates follow the real districts (Chilonzor, Yunusobod, Mirzo Ulug'bek,
# Yakkasaroy, Shayxontohur, Sergeli, Mirobod, Olmazor). Two branches of the
# same business share mall coordinates to demo the coincident-pin selector
# (spec §14).
DEMO_BUSINESSES = [
    _biz(
        "Lavash Baraka",
        "lavash-baraka",
        "restaurant",
        "+998 93 501 77 20",
        "Сеть уличных лавашных: два пункта в Чиланзоре и Юнусабаде.",
        "Горячий лаваш от 12 000 сум",
        "Свежий лаваш весь день, тесто заводим каждое утро. Комбо: лаваш + "
        "айран — 19 000 сум. Доставка по району за 30 минут.",
        [
            ("Чиланзор-12", "Ташкент, Чиланзор-12, ул. Катартал, 45", 69.2220, 41.2870),
            ("Юнусабад-4", "Ташкент, Юнусабад-4, ул. А. Каххара, 12", 69.2890, 41.3410),
        ],
    ),
    _biz(
        "Oshxona Zarafshon",
        "oshxona-zarafshon",
        "restaurant",
        "+998 90 340 55 18",
        "Osh markazi Chorsu yaqinida: tandir va qozon taomlari.",
        "Ош в казане, каждое утро с 7:00",
        "Настоящий ош из дровяной печи, плов по-фергански по средам и "
        "пятницам. Порция 30 000 сум, чайник чая в подарок до 10:00.",
        [
            ("Чорсу", "Ташкент, Кичик Бешёгоч, 12 (рядом с Чорсу)", 69.2290, 41.3270),
        ],
    ),
    _biz(
        "Choyxona Qumush",
        "choyxona-qumush",
        "cafe",
        "+998 97 766 04 32",
        "Тихая чайхона во дворе: топчаны, самовар, настольные игры.",
        "Плов по-самаркандски по субботам",
        "Каждую субботу готовим самаркандский плов в большом казане. Порция "
        "35 000 сум, детям до 7 лет — бесплатно. Бронируйте топчаны заранее.",
        [
            ("Якасарай", "Ташкент, ул. Шота Руставели, 61", 69.2610, 41.2860),
        ],
    ),
    _biz(
        "Non Tuyg'usi",
        "non-tuygusi",
        "cafe",
        "+998 94 632 18 09",
        "Pechka nonlar: obi-non, patir, chim-chirma.",
        "Горячая патир и оби-нон с 6:00 утра",
        "Свежий хлеб из тандыра к утреннему чаю. Патир — 4 000, оби-нон — "
        "3 000 сум. К вечеру всегда горячие лепёшки к плову.",
        [
            ("Олмазор-2", "Ташкент, Олмазор-2, ул. Соглик, 17", 69.2080, 41.3440),
        ],
    ),
    _biz(
        "Kafe Bahor",
        "kafe-bahor",
        "cafe",
        "+998 91 240 66 75",
        "Домашняя кухня: завтраки, лагман, мампар.",
        "Бизнес-ланч 28 000 сум, с 12:00 до 16:00",
        "Комплексный обед: суп + второе + компот. Меню меняется каждый день. "
        "Свежие самса и манты к обеду, чайник чая бесплатно.",
        [
            ("Юнусабад-11", "Ташкент, Юнусабад-11, ул. А. Каххара, 45", 69.2930, 41.3370),
        ],
    ),
    _biz(
        "Sartaroshxona Alisher",
        "sartaroshxona-alisher",
        "beauty",
        "+998 99 411 52 87",
        "Erkaklar sartaroshxonasi: soch, soqol bo'yash.",
        "Мужская стрижка 45 000 + борода 30 000 сум",
        "Опытные мастера, работаем без выходных с 9:00 до 21:00. Стрижка "
        "машинкой — 30 000 сум. Запись по телефону или в Telegram.",
        [
            ("Чиланзор-9", "Ташкент, Чиланзор-9, ул. Чиланзор, 34", 69.2270, 41.2940),
        ],
    ),
    _biz(
        "Go'zal Beauty",
        "gozal-beauty",
        "beauty",
        "+998 90 925 31 44",
        "Go'zallik saloni: soch, tirnoq, grim.",
        "Свадебный макияж — запись за 3 дня",
        "Свадебный пакет: макияж, причёска и пробный образ — 800 000 сум. "
        "Наращивание ресниц от 180 000 сум. Работаем с 9:00 до 20:00.",
        [
            (
                "Юнусабад Mall, 2 этаж",
                "Ташкент, Юнусабад-15, ТРЦ «Юнусабад Mall», 2 этаж",
                69.2790,
                41.3520,
            ),
            (
                "Юнусабад Mall, 3 этаж",
                "Ташкент, Юнусабад-15, ТРЦ «Юнусабад Mall», 3 этаж",
                69.2790,
                41.3520,
            ),
        ],
    ),
    _biz(
        "Studio Zuhra",
        "studio-zuhra",
        "beauty",
        "+998 93 774 90 26",
        "Kosmetologiya va tirnoq dizayni studiyasi.",
        "Наращивание ресниц −30% до конца месяца",
        "Классика, 2D и 3D-эффект. Маникюр с покрытием — 150 000 сум. "
        "Стерильные инструменты, одноразовые наборы. Запись за день.",
        [
            ("Мирзо Улугбек", "Ташкент, пр-т Мирзо Улугбека, 74", 69.3110, 41.3040),
        ],
    ),
    _biz(
        "Registon Sport",
        "registon-sport",
        "fitness",
        "+998 97 120 88 53",
        "Sport zal: kardi-zona, og'ir atletika, kurash.",
        "Годовой абонемент — 4 месяца в подарок",
        "Тренажёрный зал 1200 м², кардио-зона и зал единоборств. Персональный "
        "тренер — первая тренировка бесплатно. Открыты 6:00–23:00.",
        [
            ("Юнусабад-19", "Ташкент, Юнусабад-19, ул. Богишамол, 205", 69.3220, 41.3390),
        ],
    ),
    _biz(
        "Yoga Bog'i",
        "yoga-bogi",
        "fitness",
        "+998 94 208 45 61",
        "Yoga studiyasi: xatto, kundalini, meditatsiya.",
        "Утренняя хатха-йога, группы до 8 человек",
        "Занятия утром в 7:30 и вечером в 19:00. Первое занятие — бесплатно. "
        "Абонемент на 8 занятий — 400 000 сум. Коврики выдаём.",
        [
            ("Якасарай", "Ташкент, ул. Богишамол, 223", 69.2720, 41.2810),
        ],
    ),
    _biz(
        "Shifo Dent",
        "shifo-dent",
        "medicine",
        "+998 71 200 30 40",
        "Stomatologiya: davolash, plomba, gigiyena.",
        "Чистка и полировка зубов — 250 000 сум",
        "Ультразвуковая чистка + Air Flow + полировка. Консультация "
        "бесплатная. Работаем без обеда, с 9:00 до 20:00. Рассрочка на лечение.",
        [
            ("Чиланзор", "Ташкент, ул. Хамида Олимжона, 5", 69.2350, 41.2840),
        ],
    ),
    _biz(
        "Tez Natija Lab",
        "tez-natija-lab",
        "medicine",
        "+998 90 177 62 98",
        "Tibbiy laboratoriya: 200+ tahlil turi.",
        "Анализы за 2 часа — результаты в Telegram",
        "Более 200 видов анализов, забор крови с 7:30. Общий анализ крови — "
        "45 000 сум. Результаты отправим в WhatsApp или Telegram.",
        [
            ("Юнусабад-6", "Ташкент, Юнусабад-6, ул. Увайсий, 3", 69.2810, 41.3480),
        ],
    ),
    _biz(
        "Mebel Bazar",
        "mebel-bazar",
        "retail",
        "+998 91 550 76 12",
        "Mebel saloni: divan, shkaf, oshxona garnituri.",
        "Диваны в рассрочку без переплаты",
        "Более 40 моделей диванов на складе. Рассрочка до 12 месяцев без "
        "первого взноса. Доставка по Ташкенту и подъём на этаж — бесплатно.",
        [
            ("Сергели-8", "Ташкент, Сергели-8, ул. Янги Сергели, 3", 69.2430, 41.2470),
        ],
    ),
    _biz(
        "Texno Savdo",
        "texno-savdo",
        "retail",
        "+998 93 388 21 47",
        "Smartfon va noutbuklar do'koni.",
        "Смартфоны в рассрочку 0% на 12 месяцев",
        "Официальная гарантия 12 месяцев. Trade-in: обменяйте старый смартфон "
        "на новый с доплатой. Наушники в подарок к покупкам от 2 млн сум.",
        [
            ("Юнусабад-4", "Ташкент, Юнусабад-4, ул. Амира Темура, 108", 69.2960, 41.3460),
        ],
    ),
    _biz(
        "Avtoservis 24 Soat",
        "avtoservis-24-soat",
        "services",
        "+998 97 443 05 79",
        "Avtoservis: dvigatel, podveska, elektrik.",
        "Компьютерная диагностика — бесплатно",
        "Диагностика бесплатно при ремонте у нас. Замена масла с фильтром — "
        "от 180 000 сум. Работаем круглосуточно, эвакуатор по городу.",
        [
            ("Кичик халка йули", "Ташкент, Кичик халка йули, 71", 69.2080, 41.2780),
        ],
    ),
    _biz(
        "Quruq Tozalash Markazi",
        "quruq-tozalash-markazi",
        "services",
        "+998 90 601 38 25",
        "Kimyoviy tozalash: palto, kostyum, gilam.",
        "Химчистка пальто — 60 000 сум",
        "Чистка верхней одежды, костюмов и ковров. Заберём и привезём сами — "
        "бесплатно по городу. Срочная чистка за сутки.",
        [
            ("Шайхантахур", "Ташкент, ул. Фаргона йули, 12", 69.2460, 41.3220),
        ],
    ),
    _biz(
        "IELTS Studio",
        "ielts-studio",
        "education",
        "+998 94 715 60 33",
        "IELTS tayyorlov kurslari: 6.0+ kafolati.",
        "Пробный IELTS-тест в субботу — бесплатно",
        "Курсы подготовки к IELTS с преподавателями 8.0+. Группы до 10 "
        "человек, 3 раза в неделю. Гарантия 6.0+ или возврат оплаты.",
        [
            ("Мирзо Улугбек", "Ташкент, ул. Буюк Ипак Йули, 229", 69.3320, 41.3000),
        ],
    ),
    _biz(
        "Kod Maktabi",
        "kod-maktabi",
        "education",
        "+998 99 822 47 16",
        "Dasturlash kurslari: Python, frontend.",
        "Python для школьников 12–16 лет",
        "Курс программирования с нуля: 5 месяцев, 2 занятия в неделю. Свои "
        "проекты и защита в конце курса. Первое занятие — бесплатно.",
        [
            ("Якасарай", "Ташкент, ул. Шота Руставели, 32", 69.2570, 41.2900),
        ],
    ),
    _biz(
        "Registon Toyxona",
        "registon-toyxona",
        "restaurant",
        "+998 90 500 11 08",
        "Toy va bazmlar uchun zal: 300 o'rin, o'z oshpazi.",
        "Свадебный зал на 300 гостей, свой ош",
        "Два зала: большой на 300 и малый на 80 гостей. Свой повар, плов на "
        "дровах, живая музыка. Бронь на лето открыта.",
        [
            ("Сергели-6", "Ташкент, Сергели-6, ул. Янги Хаёт, 4", 69.2280, 41.2300),
        ],
    ),
    _biz(
        "Kebob Uy",
        "kebob-uy",
        "restaurant",
        "+998 93 689 72 84",
        "Kaboblar va milliy taomlar yetkazib berish.",
        "Доставка шашлыка за 40 минут",
        "Шашлык из баранины и курицы, приготовим и привезём горячим. Набор на "
        "компанию из 4 человек — 220 000 сум. Работаем до 23:00.",
        [
            ("Миробод", "Ташкент, ул. Афросиёб, 3", 69.2870, 41.3030),
        ],
    ),
]

# --- Generated filler: ~80 more active advertisers across Tashkent ----------
#
# Deterministic (seeded RNG) so repeated `seed --demo --reset` runs produce
# identical rows. All generated businesses get the default scenario: paid,
# approved, active placements everywhere on the map.
_RANDOM_SEED = 20261015
_TARGET_GENERATED = 80

# Real Tashkent districts with rough bounding boxes and real street names.
_DISTRICTS = [
    {
        "label": "Чиланзор",
        "lon": (69.18, 69.25),
        "lat": (41.27, 41.31),
        "streets": ["ул. Катартал", "ул. Чиланзор", "ул. Хамида Олимжона", "ул. Кушбеги"],
    },
    {
        "label": "Юнусабад",
        "lon": (69.26, 69.34),
        "lat": (41.32, 41.37),
        "streets": ["ул. А. Каххара", "ул. Богишамол", "ул. Увайсий", "ул. Ниёз"],
    },
    {
        "label": "Мирзо Улугбек",
        "lon": (69.27, 69.35),
        "lat": (41.28, 41.32),
        "streets": ["пр-т Мирзо Улугбека", "ул. Буюк Ипак Йули", "ул. А. Кодирий"],
    },
    {
        "label": "Якасарай",
        "lon": (69.24, 69.29),
        "lat": (41.27, 41.30),
        "streets": ["ул. Шота Руставели", "ул. Фаргона йули", "ул. Богишамол"],
    },
    {
        "label": "Шайхантахур",
        "lon": (69.20, 69.27),
        "lat": (41.31, 41.34),
        "streets": ["ул. Навои", "ул. Мукими", "ул. Кичик Бешёгоч", "ул. Зангиота"],
    },
    {
        "label": "Олмазор",
        "lon": (69.19, 69.25),
        "lat": (41.33, 41.36),
        "streets": ["ул. Соглик", "ул. Бодомзор йули", "ул. Кичик халка йули"],
    },
    {
        "label": "Сергели",
        "lon": (69.19, 69.28),
        "lat": (41.22, 41.27),
        "streets": ["ул. Янги Сергели", "ул. Янги Хаёт", "ул. Бешкайрагач"],
    },
    {
        "label": "Миробод",
        "lon": (69.26, 69.31),
        "lat": (41.28, 41.31),
        "streets": ["ул. Афросиёб", "ул. Нукус", "пр-т Амира Темура"],
    },
    {
        "label": "Бектемир",
        "lon": (69.29, 69.36),
        "lat": (41.21, 41.25),
        "streets": ["Ахангаранское шоссе", "ул. Бектемир"],
    },
    {
        "label": "Учтепа",
        "lon": (69.14, 69.20),
        "lat": (41.29, 41.33),
        "streets": ["ул. Коратош", "пр-т Бунёдкор", "ул. Кушбеги"],
    },
]

_WORDS = [
    "Bahor",
    "Zarafshon",
    "Registon",
    "Navruz",
    "Yulduz",
    "Nodira",
    "Osiyo",
    "Sharq",
    "Chust",
    "Xiva",
    "Buxoro",
    "Farg'ona",
    "Nurafshon",
    "Baraka",
    "Dilnoza",
    "Kamola",
    "Zilola",
    "Asl",
    "Oltin",
    "Kumush",
    "Durdona",
    "Anhor",
    "Chinor",
    "Gulzor",
    "Navo",
    "Temur",
    "Sarbon",
    "Ulug'bek",
    "Shodlik",
    "Tillo",
    "Lola",
    "Rayhon",
    "Sultan",
    "Farhod",
    "Sirdaryo",
    "Amir",
    "Jahon",
    "Osmon",
    "Vatan",
    "Saodat",
    "Iste'dod",
    "Imkon",
]

_NAME_PATTERNS = {
    "restaurant": [
        "Osh Markazi {w}",
        "Lavash {w}",
        "Kebob Uy {w}",
        "Toyxona {w}",
        "Pitsa {w}",
        "Burger {w}",
    ],
    "cafe": ["Choyxona {w}", "Kafe {w}", "Qandolat {w}", "Non Tuyg'usi {w}", "Coffee {w}"],
    "beauty": [
        "Salon {w}",
        "Sartaroshxona {w}",
        "Beauty Studio {w}",
        "Nail Studio {w}",
        "Go'zal {w}",
    ],
    "fitness": ["Sport Zal {w}", "Fitness {w}", "Yoga {w}", "Boks Klubi {w}"],
    "retail": ["{w} Savdo", "Mebel {w}", "Texno {w}", "Kiyim Bozori {w}", "Oshxona Uskunalari {w}"],
    "services": [
        "Avtoservis {w}",
        "Quruq Tozalash {w}",
        "Usta {w}",
        "Ta'mirlash {w}",
        "Kir Yuvish {w}",
    ],
    "medicine": ["Stomatologiya {w}", "Laboratoriya {w}", "Tibbiy Markaz {w}", "Shifo {w}"],
    "education": ["{w} Kurslari", "Ingliz Tili {w}", "IT Maktab {w}", "Abilyuent {w}"],
}

_CATEGORY_SHARE = {
    "restaurant": 16,
    "cafe": 12,
    "beauty": 12,
    "retail": 10,
    "services": 10,
    "fitness": 8,
    "medicine": 6,
    "education": 6,
}

_PRICE_RANGES = {
    "lunch": (25, 35),
    "lavash": (10, 16),
    "osh": (28, 40),
    "haircut": (35, 60),
    "nails": (120, 180),
    "month": (250, 400),
    "clean": (200, 350),
    "dry": (50, 90),
    "repair": (100, 250),
    "course": (500, 1500),
    "checkup": (300, 900),
    "lash": (150, 260),
    "burger": (18, 28),
}

_HEADLINES = {
    "restaurant": [
        "Бизнес-ланч от {lunch} 000 сум",
        "Лаваш от {lavash} 000 сум",
        "Ош в казане — {osh} 000 сум",
        "Доставка за 30 минут по району",
        "Бургер комбо — {burger} 000 сум",
    ],
    "cafe": [
        "Завтраки с 7:00 — от {lunch} 000 сум",
        "Свежая выпечка каждое утро",
        "Кофе + десерт = {lavash} 000 сум",
        "Плов по субботам — {osh} 000 сум",
    ],
    "beauty": [
        "Стрижка от {haircut} 000 сум",
        "Маникюр — {nails} 000 сум",
        "Наращивание ресниц от {lash} 000 сум",
        "Скидка 20% на первое посещение",
    ],
    "fitness": [
        "Абонемент на месяц — {month} 000 сум",
        "Первая тренировка бесплатно",
        "Год без ограничений — 3 000 000 сум",
        "Утренние группы с 7:00",
    ],
    "retail": [
        "Рассрочка 0% на 12 месяцев",
        "Скидки до 30% на весь ассортимент",
        "Trade-in — доплата от 200 000 сум",
        "Новинки каждую неделю",
    ],
    "services": [
        "Химчистка — от {dry} 000 сум",
        "Ремонт от {repair} 000 сум",
        "Диагностика бесплатно",
        "Срочный заказ за сутки",
    ],
    "medicine": [
        "Чистка зубов — {clean} 000 сум",
        "Консультация — 50 000 сум",
        "Комплексный чекап — от {checkup} 000 сум",
        "Анализы за 2 часа",
    ],
    "education": [
        "Пробный урок бесплатно",
        "Курс — от {course} 000 сум",
        "Занятия 3 раза в неделю",
        "IELTS подготовка, группы до 10 человек",
    ],
}

_CATEGORY_UZ = {
    "restaurant": "Milliy va yevropa taomlari.",
    "cafe": "Kafe va qandolat mahsulotlari.",
    "beauty": "Go'zallik saloni va sartaroshxona.",
    "fitness": "Sport zal va guruh mashg'ulotlari.",
    "retail": "Chakana savdo.",
    "services": "Xizmatlar va ta'mirlash.",
    "medicine": "Tibbiy xizmatlar.",
    "education": "O'quv kurslari.",
}

_BODIES = {
    "restaurant": [
        "Готовим на открытом огне, тесто и соусы делаем сами. Работаем с 10:00 "
        "до 23:00, без выходных. Доставка по району — бесплатно от 50 000 сум.",
        "Свежие продукты каждое утро с рынка. Порции большие, чайник чая в "
        "подарок к обеду. Бронь столов по телефону.",
    ],
    "cafe": [
        "Уютный зал, Wi-Fi и розетки. Завтраки подаём до 12:00, бизнес-ланч "
        "с 12:00 до 16:00. Кофе зерновой, десерты собственной кондитерской.",
        "Тихий двор, топчаны и самовар. Настольные игры для гостей бесплатно. "
        "По выходным живая музыка с 19:00.",
    ],
    "beauty": [
        "Мастера с опытом от 5 лет, стерильные инструменты. Запись по телефону "
        "или в Telegram. Работаем ежедневно с 9:00 до 21:00.",
        "Используем профессиональную косметику. Пенсионерам скидка 10% по "
        "будням до 12:00. Оплата наличными и картой.",
    ],
    "fitness": [
        "Тренажёрный зал, кардио-зона и раздевалки с душем. Персональный "
        "тренер составит программу. Абонемент можно заморозить на месяц.",
        "Групповые занятия утром и вечером. Первое пробное занятие — "
        "бесплатно. Коврики и инвентарь выдаём на месте.",
    ],
    "retail": [
        "Более 300 товаров в наличии. Официальная гарантия, рассрочка без "
        "первого взноса. Доставка по Ташкенту на следующий день.",
        "Прямые поставки от производителя. Обмен и возврат в течение 14 дней. "
        "Оптовым покупателям — скидка до 15%.",
    ],
    "services": [
        "Опытные мастера, работа под ключ с гарантией 6 месяцев. Выезд "
        "специалиста на дом — бесплатно. Работаем ежедневно с 8:00 до 20:00.",
        "Срочные заказы выполняем за сутки. Оплата после приёмки работы. "
        "Скидка 10% при заказе от двух услуг.",
    ],
    "medicine": [
        "Приём по записи и в порядке живой очереди. Современное оборудование, "
        "врачи с сертификатами. Детский приём после 15:00.",
        "Работаем без обеда с 8:00 до 20:00. Рассрочка на лечение, страховки "
        "принимаем. Результаты анализов — в WhatsApp или Telegram.",
    ],
    "education": [
        "Группы до 10 человек, занятия 2–3 раза в неделю. Пробное занятие "
        "бесплатно. Сертификат по окончании курса.",
        "Преподаватели с опытом от 5 лет. Занятия утром и вечером, есть "
        "группы выходного дня. Оплата частями — возможна.",
    ],
}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _generate_extra_businesses(rng, used_names):
    out = []
    for category, count in _CATEGORY_SHARE.items():
        patterns = _NAME_PATTERNS[category]
        for _ in range(count):
            # unique name: pattern + word, retry until unused
            while True:
                name = rng.choice(patterns).format(w=rng.choice(_WORDS))
                if name not in used_names:
                    break
            used_names.add(name)

            district = rng.choice(_DISTRICTS)
            street = rng.choice(district["streets"])

            branches = []
            n_branches = 2 if rng.random() < 0.15 else 1
            for _ in range(n_branches):
                massif = f"{district['label']}-{rng.randint(2, 21)}"
                house = rng.randint(1, 120)
                lon = round(rng.uniform(*district["lon"]), 4)
                lat = round(rng.uniform(*district["lat"]), 4)
                branches.append(
                    (
                        massif,
                        f"Ташкент, {massif}, {street}, {house}",
                        lon,
                        lat,
                    )
                )

            headline_tpl = rng.choice(_HEADLINES[category])
            fields = [f for _, f, _, _ in string.Formatter().parse(headline_tpl) if f]
            values = {k: rng.randint(*_PRICE_RANGES[k]) for k in fields}
            headline = headline_tpl.format(**values)
            body = rng.choice(_BODIES[category])
            phone = (
                f"+998 {rng.choice([90, 91, 93, 94, 95, 97, 98, 99])} "
                f"{rng.randint(200, 999)} {rng.randint(10, 99)} {rng.randint(10, 99)}"
            )
            description = f"{_CATEGORY_UZ[category]} {district['label']} tumanida."
            out.append(
                _biz(
                    name,
                    _slugify(name),
                    category,
                    phone,
                    description,
                    headline,
                    body,
                    branches,
                )
            )
    return out


DEMO_BUSINESSES = DEMO_BUSINESSES + _generate_extra_businesses(
    random.Random(_RANDOM_SEED), {b["name"] for b in DEMO_BUSINESSES}
)

# Campaign scenarios beyond the default approved+active ones.
# (slug, scenario) — scenario in {pending_payment, paid_pending_review, draft,
# submitted, rejected_refunded, auto_renew, grant}
SCENARIOS = {
    "non-tuygusi": "draft",
    "ielts-studio": "submitted",
    "avtoservis-24-soat": "rejected_refunded",
    "shifo-dent": "paid_pending_review",
    "registon-sport": "auto_renew",
    "yoga-bogi": "grant",
}

# Cyrillic-capable fonts, tried in order (DejaVu in the backend container,
# macOS fallbacks for local seeding).
_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def _load_font(size: int):
    from PIL import ImageFont

    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _banner_image(name: str, headline: str, phone: str) -> str:
    """Generate a promo-style banner PNG; return the storage key."""
    import colorsys
    import io

    from django.core.files.base import ContentFile
    from PIL import Image, ImageDraw

    width, height = 1200, 400
    digest = hashlib.sha256(name.encode()).digest()
    # Warm, saturated ad palettes keyed off the business name.
    hue_a = (digest[0] / 255 * 360, 72, 58)
    hue_b = ((digest[0] + 45) % 360, 68, 78)

    def hsv_rgb(h, s, v):
        r, g, b = colorsys.hsv_to_rgb(h / 360, s / 100, v / 100)
        return int(r * 255), int(g * 255), int(b * 255)

    img = Image.new("RGB", (width, height))
    px = img.load()
    ca, cb = hsv_rgb(*hue_a), hsv_rgb(*hue_b)
    for x in range(width):
        t = x / width
        color = tuple(int(a + (b - a) * t) for a, b in zip(ca, cb))
        for y in range(height):
            px[x, y] = color

    # Soft decorative circles on the right (over the darker end for contrast).
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((width - 340, -120, width + 120, 240), fill=(255, 255, 255, 26))
    od.ellipse((width - 220, 180, width + 100, 480), fill=(0, 0, 0, 34))
    img = Image.alpha_composite(img.convert("RGBA"), overlay)

    draw = ImageDraw.Draw(img)
    font_head = _load_font(62)
    font_name = _load_font(34)
    font_badge = _load_font(26)

    # «РЕКЛАМА» marking (required on ads in Uzbekistan).
    badge_text = "РЕКЛАМА"
    badge_w = draw.textlength(badge_text, font=font_badge)
    draw.rounded_rectangle((56, 44, 56 + badge_w + 28, 96), radius=12, fill=(255, 255, 255, 235))
    draw.text((70, 54), badge_text, fill=(24, 24, 24), font=font_badge)

    # Headline wrapped to two lines.
    max_w = width - 120
    words = headline.split()
    lines, cur = [], ""
    for word in words:
        attempt = f"{cur} {word}".strip()
        if draw.textlength(attempt, font=font_head) <= max_w:
            cur = attempt
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    if len(lines) > 2:
        lines = lines[:2]
        lines[1] = lines[1][: max(len(lines[1]) - 1, 0)] + "…"
    y = 150
    for line in lines:
        draw.text((56, y), line, fill=(255, 255, 255, 255), font=font_head)
        y += 76

    # Business name + phone footer.
    footer = f"{name}  ·  {phone}"
    if draw.textlength(footer, font=font_name) > max_w:
        footer = name
    draw.text((56, height - 66), footer, fill=(255, 255, 255, 235), font=font_name)

    key = f"banners/demo-{uuid.uuid4().hex[:10]}.png"
    buffer = io.BytesIO()
    img.convert("RGB").save(buffer, format="PNG")
    default_storage.save(key, ContentFile(buffer.getvalue()))
    return key


def seed_demo(*, reset: bool = False, log=print) -> None:
    from apps.accounts.models import User
    from apps.billing.models import Order, OrderItem, Refund, Tariff
    from apps.billing.services import create_checkout, create_quote, process_refund, request_refund
    from apps.businesses.models import Business, BusinessCategory
    from apps.campaigns.models import Campaign
    from apps.locations.models import Location
    from apps.moderation.services import approve_campaign, reject_campaign, submit_for_review
    from apps.payments.models import PaymentAttempt
    from apps.payments.settlement import settle_payment_attempt
    from apps.placements.models import Placement
    from apps.placements.services import issue_free_grant
    from apps.renewals.models import RenewalAgreement

    owner, _ = User.objects.get_or_create(phone_e164="+998901234567")
    staff, _ = User.objects.get_or_create(
        phone_e164="+998901110000", defaults={"is_staff": True, "is_superuser": True}
    )
    if staff.has_usable_password() is False or not staff.password:
        staff.set_password("admin12345")
        staff.save(update_fields=["password"])

    if reset:
        # PROTECT FKs everywhere — delete in dependency order, children first.
        from apps.billing.models import OrderItem, Refund
        from apps.campaigns.models import CampaignReview
        from apps.payments.models import PaymentAttempt, PaymentEvent
        from apps.placements.models import FreeGrant
        from apps.renewals.models import RenewalAgreement, RenewalAttempt

        RenewalAttempt.objects.all().delete()
        RenewalAgreement.objects.filter(business__owner=owner).delete()
        Placement.objects.filter(campaign__business__owner=owner).delete()
        FreeGrant.objects.filter(business__owner=owner).delete()
        CampaignReview.objects.filter(
            campaign__business__owner=owner
        ).delete()  # demo reset only; real reviews are append-only
        PaymentEvent.objects.all().delete()
        PaymentAttempt.objects.filter(order__business__owner=owner).delete()
        Refund.objects.filter(order__business__owner=owner).delete()
        OrderItem.objects.filter(order__business__owner=owner).delete()
        Order.objects.filter(business__owner=owner).delete()
        Campaign.objects.filter(business__owner=owner).delete()
        Location.objects.filter(business__owner=owner).delete()
        Business.objects.filter(owner=owner).delete()
        log("reset: demo data cleared")

    Tariff.objects.get_or_create(amount_per_24h=30_000_00)

    categories = {}
    for slug, ru, uz in [
        ("restaurant", "Рестораны", "Restoranlar"),
        ("cafe", "Кафе", "Kafelar"),
        ("beauty", "Красота и салон", "Go'zallik saloni"),
        ("fitness", "Фитнес", "Fitnes"),
        ("retail", "Магазины", "Do'konlar"),
        ("services", "Услуги", "Xizmatlar"),
        ("medicine", "Медицина", "Tibbiyot"),
        ("education", "Образование", "Ta'lim"),
    ]:
        categories[slug] = BusinessCategory.objects.get_or_create(
            slug=slug, defaults={"name_ru": ru, "name_uz": uz}
        )[0]

    now = timezone.now()

    def purchase(campaign, locations, days, *, auto_renew=False):
        submit_for_review(campaign=campaign)
        order = create_quote(
            user=owner,
            business_id=campaign.business_id,
            campaign_id=campaign.id,
            location_ids=[loc.id for loc in locations],
            requested_start_at=now - timedelta(minutes=30),
            requested_end_at=now + timedelta(days=days),
            auto_renew=auto_renew,
        )
        attempt, _ = create_checkout(user=owner, order_id=order.id)
        attempt.status = PaymentAttempt.Status.SUCCEEDED
        attempt.save(update_fields=["status", "updated_at"])
        settle_payment_attempt(attempt.id)
        return order

    stats = {"businesses": 0, "locations": 0, "campaigns": 0, "active_placements": 0}

    for biz in DEMO_BUSINESSES:
        business, created = Business.objects.get_or_create(
            slug=biz["slug"],
            defaults={
                "owner": owner,
                "name": biz["name"],
                "category": categories[biz["category"]],
                "phone": biz["phone"],
                "description": biz["description"],
            },
        )
        if created:
            stats["businesses"] += 1
        locations = []
        for label, address, lon, lat in biz["branches"]:
            location, loc_created = Location.objects.get_or_create(
                business=business,
                name=label,
                defaults={
                    "address": address,
                    "point": Point(lon, lat, srid=4326),
                    "phone": biz["phone"],
                },
            )
            if loc_created:
                stats["locations"] += 1
            locations.append(location)

        campaign, camp_created = Campaign.objects.get_or_create(
            business=business,
            headline=biz["headline"],
            defaults={
                "body": biz["body"],
                "banner_key": _banner_image(biz["name"], biz["headline"], biz["phone"]),
            },
        )
        if camp_created:
            stats["campaigns"] += 1

        if not campaign.orders.exists():
            scenario = SCENARIOS.get(biz["slug"], "active")
            if scenario == "draft":
                campaign.review_status = Campaign.ReviewStatus.DRAFT
                campaign.save(update_fields=["review_status", "updated_at"])
            elif scenario == "submitted":
                submit_for_review(campaign=campaign)
            elif scenario == "paid_pending_review":
                purchase(campaign, locations[:1], days=5)  # paid, awaiting moderation
            elif scenario == "rejected_refunded":
                order = purchase(campaign, locations[:1], days=5)
                reject_campaign(
                    campaign=campaign,
                    reviewer=staff,
                    reason="Нерабочий номер телефона в объявлении",
                )
                refund = request_refund(user=owner, order_id=order.id, reason="Кампания отклонена")
                process_refund(staff=staff, refund_id=refund.id, decision="approve")
            elif scenario == "auto_renew":
                purchase(campaign, locations[:1], days=1, auto_renew=True)
                approve_campaign(campaign=campaign, reviewer=staff)
            elif scenario == "grant":
                submit_for_review(campaign=campaign)
                approve_campaign(campaign=campaign, reviewer=staff)
                issue_free_grant(
                    staff=staff,
                    campaign=campaign,
                    location=locations[0],
                    start_at=now - timedelta(hours=1),
                    end_at=now + timedelta(days=4),
                    reason="Партнёрский грант для нового направления",
                )
            else:  # active
                purchase(campaign, locations, days=7)
                approve_campaign(campaign=campaign, reviewer=staff)

    stats["active_placements"] = Placement.objects.filter(
        state=Placement.State.ACTIVE, campaign__business__owner=owner
    ).count()
    stats["renewal_agreements"] = RenewalAgreement.objects.filter(business__owner=owner).count()
    log(
        f"demo ready: +{stats['businesses']} businesses, +{stats['locations']} locations, "
        f"+{stats['campaigns']} campaigns, {stats['active_placements']} active placements, "
        f"{stats['renewal_agreements']} renewal agreement(s)"
    )
