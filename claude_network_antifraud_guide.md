# Руководство по сетевой инфраструктуре и обходу антифрод-систем для Claude и Claude API

> **Статус документа:** Производственная спецификация / Network Security & Anti-Fraud Architecture  
> **Целевые сервисы:** `claude.ai`, `api.anthropic.com`, Anthropic Console, Claude Code CLI  
> **Дата обновления:** Ноябрь 2026 г.

---

## 1. Типы прокси и скоринг IP-репутации

### 1.1. Почему датацентровые IP (AWS, Hetzner, DigitalOcean, OVH) блокируются мгновенно

Anthropic использует многоуровневую защиту от ботов, ключевыми звеньями которой являются **Cloudflare Bot Management (Enterprise)**, Cloudflare Turnstile, а также внутренние эвристические анализаторы трафика.

Датацентровые IP-адреса (DCH / Hosting) получают наивысший **Fraud Score** и блокируются по следующим фундаментальным причинам:

1. **ASN-классификация (BGP Routing Data):**  
   Каждый IP-адрес привязан к автономной системе (ASN). Автономные системы крупных хостинг-провайдеров:
   - AWS: `AS16509`, `AS14618`
   - Hetzner: `AS24940`
   - DigitalOcean: `AS14061`
   - OVH: `AS16276`
   - Linode / Akamai: `AS63949`  
   Все эти пулы в базах данных (MaxMind, IP2Location, Spur, IPQS) имеют жесткую метку типа использования: `hosting`, `data_center` или `transit`. Легитимный обычный пользователь **никогда** не выходит в интернет для веб-серфинга непосредственно из серверной стойки в датацентре.
2. **Cloudflare Bot Score (`cf.bot_management.score`):**  
   Cloudflare автоматически присваивает каждому входящему запросу оценку от 1 до 99:
   - `1 - 29`: Автоматизированный трафик / бот.
   - `30 - 99`: Человек / доверенный клиент.  
   Датацентровые IP по умолчанию стартуют со скорингом ниже 30. Для `claude.ai` включено строгое правило WAF: при `score < 30` либо сразу отдавать `HTTP 403 Forbidden` / `Cloudflare 1020 Access Denied`, либо переводить сессию в бесконечный цикл `Turnstile Challenge`.
3. **История злоупотреблений подсетей (Subnet Collateral Damage):**  
   Датацентровые подсети массово используются сканерами уязвимостей, спам-ботами, парсерами и дорвей-фермами. Провайдеры антифрода агрегируют статистику на уровне всей подсети `/24` (256 адресов) или `/20`. Если даже ваш конкретный VPS-IP чист, "грязные" соседи по подсети опускают репутацию всего блока до нуля.
4. **Специфика Claude:**  
   В отличие от ряда других LLM-платформ, Claude API и веб-версия `claude.ai` имеют политику нулевой толерантности к DCH-адресам из неподдерживаемых регионов и блокируют их на этапе TLS Handshake или WAF Inspection.

---

### 1.2. Сравнительный анализ: ISP Static vs Rotating Residential vs Mobile 4G/5G

| Параметр | Data Center (DCH) | Rotating Residential (P2P) | Static Residential (ISP) | Mobile 4G/5G (CGNAT) |
| :--- | :--- | :--- | :--- | :--- |
| **ASN Type** | `hosting` | `isp` / `residential` | `isp` / `business` | `cellular` / `mobile` |
| **Fraud Score (IPQS)** | 85 – 100 (Критический) | 0 – 15 (Очень низкий) | 0 – 10 (Минимальный) | 0 – 5 (Идеальный) |
| **Стабильность сессии** | Статичный | Ротация (1-10 мин / per-request) | Статичный (Dedicated) | Статичный или смена по таймеру |
| **WebSocket / SSE Stream**| Рвется (WAF блокирует) | Рвется при смене IP в пуле | **Идеально стабилен** | Зависит от модема/ротации |
| **Пинг / Джиттер** | Минимальный (<20ms) | Высокий, нестабильный (P2P) | **Низкий, предсказуемый** | Средний (30-80ms) |
| **Пропускная способность**| 1-10 Gbps | 5-20 Mbps (канал хоста) | **100-1000 Mbps** | 20-100 Mbps |
| **Стоимость** | Низкая ($1-5/мес) | Оплата за трафик ($2-8/GB) | Фиксированная ($3-15/мес за IP)| Высокая ($40-100/мес за порт)|
| **Пригодность для Claude** | ❌ Непригоден | ⚠️ Только скрейпинг / 1 запрос | ✅ **Идеален для API & Web** | ✅ **Идеален для регистрации** |

#### Детальный разбор:

1. **ISP / Static Residential (Dedicated Residential):**
   - **Архитектура:** Серверы размещены в датацентре, но IP-адреса принадлежат реальным провайдерам последней мили (Comcast, Verizon, AT&T, Spectrum, CenturyLink) и зарегистрированы в RIPE/ARIN со статусом `ASSIGNED PA` и типом `isp`.
   - **Почему это лучший выбор:** Полная иллюзия домашнего абонента для Cloudflare + неограниченный трафик + стабильное TCP-соединение без обрывов. Сервисы Claude используют долгоживущие Server-Sent Events (SSE) для генерации текста токен-за-токеном. Если IP сменится в процессе ответа, сессия разорвется и Claude выдаст ошибку `Conversation interrupted`. ISP-прокси гарантирует постоянный IP на протяжении недель и месяцев.

2. **Rotating Residential (P2P Residential):**
   - **Архитектура:** Трафик маршрутизируется через зараженные или добровольные устройства пользователей (SDK в бесплатных VPN/играх, ботнеты типа Luminati/BrightData, Oxylabs, Smartproxy).
   - **Проблема для Claude:** Каждая ротация IP триггерит перепроверку сессии в Claude. Cloudflare Turnstile валидирует привязку `cf_clearance` cookie к IP-адресу и TLS-отпечатку. При смене IP cookie становится невалидной, и пользователь выбрасывается на экран верификации капчи или разлогинивается.

3. **Mobile 4G/5G Proxies:**
   - **Архитектура:** Реальные SIM-карты сотовых операторов в USB-модемах.
   - **Почему у них наивысший траст:** Мобильные операторы используют **Carrier-Grade NAT (CGNAT)**. Под одним внешним IPv4-адресом могут одновременно находиться от 5 000 до 30 000 смартфонов. Антифрод-системы Cloudflare не могут забанить такой IP, иначе заблокируют тысячи реальных платящих клиентов сотовых сетей.
   - **Назначение:** Лучший инструмент для первичной регистрации аккаунта, привязки карт зарубежных банков и прохождения самых жестких капч. Для ежедневного использования в API дорого и избыточно.

---

### 1.3. Как антифрод Claude анализирует IP-адрес

Проверка входящего подключения включает многомерный скоринг через внешние базы и собственные анализаторы Cloudflare:

```
                  ┌────────────────────────────────────────┐
                  │          Входящий IP-пакет             │
                  └──────────────────┬─────────────────────┘
                                     │
           ┌─────────────────────────┼────────────────────────┐
           ▼                         ▼                        ▼
┌────────────────────┐    ┌─────────────────────┐   ┌───────────────────┐
│ L4/L7 Анализ стека │    │    Репутационные    │   │ BGP / WHOIS / ASN │
│  (p0f, MTU, MSS,   │    │        базы         │   │   (MaxMind, RIPE, │
│   TLS ClientHello) │    │(Spamhaus, IPQS, etc)│   │       Spur)       │
└──────────┬─────────┘    └──────────┬──────────┘   └─────────┬─────────┘
           │                         │                        │
           └─────────────────────────┼────────────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │  Cloudflare Bot Score (1 - 99)  │
                    │   + Anthropic Risk Engine       │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
          Score < 30│                                 │Score >= 30
                    ▼                                 ▼
         [ 403 / Loop Challenge ]                 [ ALLOW ]
```

1. **Проверка по базам Spamhaus (SBL, XBL, CSS, ZEN):**  
   Spamhaus отслеживает скомпрометированные IP, открытые релеи и хостинги эксплоитов. Если подсеть прокси попала в Spamhaus CSS (Composite Snowshoe), Cloudflare отклоняет соединение еще на этапе SYN/ACK.
2. **IPQualityScore (IPQS) & ScamAnalytics:**  
   Оценивают параметры:
   - `Fraud Score > 75`: Мгновенный блок;
   - `is_vpn / is_proxy / is_tor`: Булевы флаги обнаружения туннелей;
   - `recent_abuse`: Наличие фактов брутфорса, спама или бот-активности за последние 48 часов;
   - `active_bot / bot_status`: Детектирование с помощью honeypot-сетей.
3. **MaxMind GeoIP2 Precision Insights:**  
   Поле `user_type`: `residential`, `cellular`, `college`, `corporate`, `hosting`. Значение `hosting` — стоп-фактор для веб-интерфейса Claude.
4. **Spur.us (IP Context API):**  
   Spur специализированно отслеживает коммерческие прокси-сервисы. Если прокси зарегистрирован в каталогах коммерческих прокси-провайдеров, Spur выставляет тег `VPN Service` или `Residential Proxy Provider`, что передается в скоринг-пайплайн.
5. **Passive OS Fingerprinting (p0f / TCP SYN Analysis):**  
   Анализируются заголовки TCP SYN пакета:
   - `TCP Window Size` (размер окна);
   - `TTL` (Time To Live — начальный TTL у Windows = 128, у Linux = 64);
   - `TCP Options` (MSS, SACK permitted, Timestamps, NOP);
   - `IP DF` (Don't Fragment bit).  
   *Аномалия:* Если пользователь в `User-Agent` отправляет `Windows NT 10.0; Win64; x64`, а TCP-стек на L4 уровне показывает Linux-ядро (потому что трафик терминируется дешевым прокси на базе Squid/Nginx на Ubuntu), система фиксирует **OS Mismatch**, что резко повышает Bot Score.

---

## 2. Сетевые расхождения и утечки (Network Leaks)

### 2.1. Утечки DNS (DNS Leaks)

**Проблема:**  
Пользователь подключает прокси в браузере или ОС, но запросы на преобразование доменных имен (`claude.ai`, `api.anthropic.com`) по-прежнему отправляются на DNS-сервера локального провайдера (Ростелеком, МТС, Билайн, China Telecom) по стандартному незашифрованному протоколу UDP на 53 порт.

**Как антифрод фиксирует утечку:**
1. **Cloudflare EDNS Client Subnet (ECS):** При резолвинге через локальный DNS запрос содержит подсеть клиента. Cloudflare CDN видит, что DNS резолвился через провайдера из РФ, а HTTP-запрос пришел с IP США. Это расхождение классифицируется как попытка сокрытия геопозиции.
2. **DNS Leak Test через JavaScript:** Веб-страницы Claude могут загружать одноразовые уникальные токены с динамических поддоменов (например, `<uuid>.metrics.anthropic.com`). Авторитетный DNS-сервер Anthropic точно знает, какой именно DNS-резолвер запросил данный уникальный UUID. Если резолвер принадлежит заблокированному региону, сессия компрометируется.

**Решение:**
- Использование защищенных протоколов DNS: **DoH (DNS-over-HTTPS)** или **DoT (DNS-over-TLS)**.
- Принудительный резолвинг DNS строго через исходящий прокси-туннель.
- Использование технологии **Fake-IP** (в Sing-box / Clash), когда реальный DNS-запрос вообще не отправляется с хоста, а перенаправляется на удаленный прокси-узел.

---

### 2.2. WebRTC / UDP Leaks (STUN-сервера)

**Проблема:**  
WebRTC (Web Real-Time Communication) предназначен для прямого голосового и видеообщения между браузерами. Для пробития NAT протокол использует технологию **ICE (Interactive Connectivity Establishment)** и STUN/TURN серверы.

**Механизм утечки:**
1. Браузер выполняет JS API вызов `new RTCPeerConnection()`.
2. Браузер отправляет UDP-пакеты на публичные STUN-серверы (например, `stun:stun.l.google.com:19302`).
3. Большинство обычных прокси (HTTP/HTTPS и стандартные SOCKS5 без UDP-ассоциации) **обрабатывают только TCP-трафик**.
4. В результате браузер отправляет UDP-пакет **в обход прокси** через дефолтный сетевой шлюз операционной системы.
5. STUN-сервер возвращает внешний IP-адрес хоста, и браузер генерирует `ICE candidate`, содержащий:
   - Реальный публичный IP пользователя (РФ/СНГ);
   - Локальный IP адрес (например, `192.168.1.45`).
6. Скрипт защиты (Cloudflare Turnstile) читает этот `ICE candidate` и немедленно передает реальный IP на сервер.

**Решение:**
- **В антидетект-браузерах:** выставить режим WebRTC `Altered` (подмена на IP прокси) или `Disable` (полное отключение).
- **В обычном браузере (Firefox):** установить `media.peerconnection.enabled = false` в `about:config`.
- **На сетевом уровне (Sing-box/Clash):** использовать TUN-режим с полной поддержкой UDP-проксирования, либо блокировать исходящий UDP на портах 3478, 5349 (STUN).

---

### 2.3. IPv6 Leaks & Двойной стек (Dual-Stack)

**Почему отключение IPv6 критически необходимо для работы с Claude:**

1. **Асимметрия стеков:** У большинства домашних провайдеров включен Dual-Stack (IPv4 + IPv6). Однако 95% арендуемых прокси-серверов предоставляют **только IPv4**.
2. **Алгоритм Happy Eyeballs (RFC 8305):**  
   Современные ОС (Windows 10/11, macOS) и браузеры отправляют DNS-запросы параллельно для A-записей (IPv4) и AAAA-записей (IPv6). Приоритет отдается протоколу IPv6, если задержка сопоставима.
3. **Обход туннеля:**  
   Поскольку прокси не имеет IPv6-шлюза или софт настроен на перехват только IPv4, IPv6-пакет летит напрямую к серверам Cloudflare через домашнего провайдера.
4. **Результат:** Cloudflare видит сессию с российского IPv6-адреса и выдает `403 Forbidden` / `Unavailable in your country`, даже если в браузере или расширении горит зеленый значок VPN/прокси США.

**Решение:**
- Полное отключение IPv6 в операционной системе на физических сетевых интерфейсах.
- Принудительное отключение AAAA-запросов на уровне DNS-клиента проксификатора (`ipv6: false`).

---

## 3. Карта критических доменов Anthropic и сопутствующих сервисов

Для организации Split-Tunneling (раздельной маршрутизации) необходимо проксировать **весь** стек доменов, с которыми взаимодействует клиент. Пропуск даже одного вспомогательного домена телеметрии или feature-flags приведет к сбою сессии.

### Таблица доменов и их назначение

| Категория | Домен / Паттерн | Роль в инфраструктуре | Последствия при пропуске |
| :--- | :--- | :--- | :--- |
| **Core Service** | `claude.ai` | Основной веб-интерфейс | Не открывается сайт |
| | `api.anthropic.com` | Claude REST API / Claude Code | Ошибка авторизации / 403 |
| | `anthropic.com` | Главный сайт и документация | Блок доступа |
| | `claude.site` | Хостинг артефактов и UI превью | Артефакты не рендерятся |
| | `claude.usercontent.com` | Загрузка и скачивание файлов/изображений | Ошибка прикрепления документов |
| **Authentication** | `anthropic.auth0.com` | Провайдер OAuth/SSO | Не работает вход по Email/Коду |
| | `*.auth0.com` | Auth0 endpoints | Ошибка валидации токена |
| | `accounts.google.com` | Sign in with Google (если используется) | Ошибка Google SSO |
| | `appleid.apple.com` | Sign in with Apple | Ошибка Apple ID SSO |
| **WAF & Security** | `challenges.cloudflare.com` | Cloudflare Turnstile CAPTCHA | Вечная капча / Infinite Loop |
| | `*.cloudflare.com` | Edge CDN / WAF инфраструктура | Блокировка на границе сети |
| | `*.cloudflareinsights.com` | Аналитика Cloudflare Turnstile | Провал валидации капчи |
| **Feature Flags** | `*.statsig.com` | Управление функциями (A/B тесты) | **Сайт зависает на скелетоне загрузки** |
| | `api.statsig.com` | Синхронизация состояний фичей | Ошибка инициализации сессии |
| **APM & Sentry** | `*.datadoghq.com` | Мониторинг производительности | Прерывание SSE сессий |
| | `browser-intake-datadoghq.com`| Клиентская телеметрия Claude Web | Предупреждение о боте |
| | `*.sentry.io` | Регистрация ошибок фронтенда | Логирование несоответствия окружения |
| **Payments** | `api.stripe.com` | Процессинг оплаты Claude Pro/Team | Ошибка оплаты подписки |
| | `checkout.stripe.com` | Страница биллинга | Сброс сессии биллинга |
| **Поддержка / CDN** | `*.intercom.io` | Чат поддержки | Ошибка виджета поддержки |
| | `intercomcdn.com` | Статика Intercom | Не загружаются скрипты хелпдеска |

> [!CRITICAL]
> **Критический домен Statsig (`statsig.com`):**  
> Самая распространенная ошибка сетевых инженеров — маршрутизировать только `*.claude.ai` и `*.anthropic.com`. Фронтенд Claude перед отображением чата делает обязательный запрос к `api.statsig.com`. Если этот запрос идет напрямую через локального провайдера из неподдерживаемой страны, Statsig возвращает пустой или деактивированный набор флагов, и веб-интерфейс навсегда зависает в режиме белого экрана или спиннера.

---

## 4. Конфигурации маршрутизации (Production-Ready)

### 4.1. Конфигурация Sing-box (версия 1.10+)

Sing-box — передовой инструмент сетевой маршрутизации, позволяющий реализовать виртуальный сетевой адаптер (TUN) с прозрачным перехватом DNS через Fake-IP и маршрутизацией по наборам правил (rule-set).

Файл: `config.json`

```json
{
  "log": {
    "level": "warn",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "tag": "dns-remote",
        "address": "https://1.1.1.1/dns-query",
        "address_resolver": "dns-direct",
        "detour": "proxy-out"
      },
      {
        "tag": "dns-direct",
        "address": "77.88.8.8",
        "detour": "direct-out"
      },
      {
        "tag": "dns-fakeip",
        "address": "fakeip"
      }
    ],
    "rules": [
      {
        "outbound": "any",
        "server": "dns-direct"
      },
      {
        "rule_set": ["anthropic-domains", "cloudflare-domains"],
        "server": "dns-fakeip"
      }
    ],
    "fakeip": {
      "enabled": true,
      "inet4_range": "198.18.0.0/15",
      "inet6_range": "fc00::/18"
    },
    "independent_cache": true,
    "strategy": "ipv4_only"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "singbox-tun",
      "inet4_address": "172.19.0.1/30",
      "auto_route": true,
      "strict_route": true,
      "stack": "mixed",
      "sniff": true,
      "sniff_override_destination": true
    }
  ],
  "outbounds": [
    {
      "type": "socks",
      "tag": "proxy-out",
      "server": "isp-us-proxy.provider.com",
      "server_port": 1080,
      "username": "user",
      "password": "password",
      "version": "5",
      "udp_over_tcp": false
    },
    {
      "type": "direct",
      "tag": "direct-out"
    },
    {
      "type": "block",
      "tag": "block-out"
    }
  ],
  "route": {
    "rules": [
      {
        "action": "sniff"
      },
      {
        "protocol": "dns",
        "action": "hijack-dns"
      },
      {
        "ip_is_private": true,
        "outbound": "direct-out"
      },
      {
        "rule_set": "anthropic-domains",
        "outbound": "proxy-out"
      },
      {
        "rule_set": "cloudflare-domains",
        "outbound": "proxy-out"
      },
      {
        "port": [3478, 5349],
        "protocol": "udp",
        "outbound": "block-out"
      }
    ],
    "rule_set": [
      {
        "tag": "anthropic-domains",
        "type": "inline",
        "rules": [
          {
            "domain": [
              "claude.ai",
              "anthropic.com",
              "claude.site",
              "claude.usercontent.com",
              "statsig.com",
              "api.statsig.com"
            ],
            "domain_suffix": [
              ".claude.ai",
              ".anthropic.com",
              ".claude.site",
              ".claude.usercontent.com",
              ".statsig.com",
              ".auth0.com",
              ".datadoghq.com",
              ".sentry.io",
              ".stripe.com",
              ".intercom.io",
              ".intercomcdn.com"
            ]
          }
        ]
      },
      {
        "tag": "cloudflare-domains",
        "type": "inline",
        "rules": [
          {
            "domain": [
              "challenges.cloudflare.com"
            ],
            "domain_suffix": [
              ".cloudflare.com",
              ".cloudflareinsights.com"
            ]
          }
        ]
      }
    ],
    "auto_detect_interface": true
  }
}
```

---

### 4.2. Конфигурация Clash / Mihomo (Clash Meta)

Для пользователей Clash Verge Rev / Flclash / Mihomo:

Файл: `claude-rules.yaml`

```yaml
port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info
ipv6: false

dns:
  enable: true
  listen: 127.0.0.1:1053
  ipv6: false
  default-nameserver:
    - 77.88.8.8
    - 1.1.1.1
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  use-hosts: true
  nameserver:
    - https://1.1.1.1/dns-query#Proxy-Claude
    - https://8.8.8.8/dns-query#Proxy-Claude
  fallback:
    - https://dns.quad9.net/dns-query#Proxy-Claude
  fallback-filter:
    geoip: true
    geoip-code: US
    ipcidr:
      - 240.0.0.0/4

proxies:
  - name: "Proxy-Claude"
    type: socks5
    server: isp-us.proxy.com
    port: 1080
    username: proxy_user
    password: proxy_password
    udp: true

rules:
  # Anthropic Core
  - DOMAIN-SUFFIX,claude.ai,Proxy-Claude
  - DOMAIN-SUFFIX,anthropic.com,Proxy-Claude
  - DOMAIN-SUFFIX,claude.site,Proxy-Claude
  - DOMAIN-SUFFIX,claude.usercontent.com,Proxy-Claude
  
  # Auth & Security
  - DOMAIN-SUFFIX,auth0.com,Proxy-Claude
  - DOMAIN-SUFFIX,challenges.cloudflare.com,Proxy-Claude
  - DOMAIN-SUFFIX,cloudflareinsights.com,Proxy-Claude
  - DOMAIN-KEYWORD,turnstile,Proxy-Claude
  
  # Feature Flags & Telemetry (Критично!)
  - DOMAIN-SUFFIX,statsig.com,Proxy-Claude
  - DOMAIN,api.statsig.com,Proxy-Claude
  - DOMAIN-SUFFIX,datadoghq.com,Proxy-Claude
  - DOMAIN-SUFFIX,sentry.io,Proxy-Claude
  
  # Billing & Extras
  - DOMAIN-SUFFIX,stripe.com,Proxy-Claude
  - DOMAIN-SUFFIX,intercom.io,Proxy-Claude
  - DOMAIN-SUFFIX,intercomcdn.com,Proxy-Claude

  # Блокировка WebRTC STUN для исключения утечек
  - DST-PORT,3478,REJECT
  - DST-PORT,5349,REJECT

  # Все остальное пускаем напрямую
  - MATCH,DIRECT
```

---

### 4.3. Настройка профилей в антидетект-браузерах (AdsPower, Dolphin{anty}, Octo)

Если доступ к `claude.ai` осуществляется через антидетект-браузер, необходимо строго выставить следующие параметры профиля:

1. **Тип подключения:**
   - Строго `SOCKS5` или `HTTP` с авторизацией по логину/паролю.
   - Обязательно проверить, чтобы IP-прокси определялся как `Residential` или `ISP`.
2. **WebRTC:**
   - Режим: **Altered** (Подменять внешний IP на IP прокси).
   - Если режим Altered нестабилен: выбрать **Disabled** (полностью отключить WebRTC).
   - Запрещено использовать режим: *Real* или *Direct*.
3. **DNS:**
   - Настройка: **Proxy DNS** (разрешать имена только через прокси-сервер).
4. **Геолокация (Geolocation):**
   - Режим: **Prompt / Auto-fill based on IP**.
   - Координаты (Latitude / Longitude) должны строго соответствовать городу и штату выходного узла прокси.
5. **Timezone (Временная зона):**
   - Выставить строго **Based on IP** (соответствие временной зоне IP-адреса, например, `America/New_York` для прокси в Нью-Йорке).
6. **Языковые заголовки (Language / Accept-Language):**
   - Основной язык: `en-US,en;q=0.9`.
   - Запрещено передавать `ru-RU`, `zh-CN` в первых позициях весов `q`.
7. **Client Hints & User-Agent:**
   - Использовать актуальные версии Chrome (на момент 2026 года — свежий мажорный релиз).
   - Заголовки `Sec-CH-UA-Platform` и ОС виртуального профиля должны быть консистентны (если платформа Windows, то `User-Agent: Windows NT 10.0`).

---

## 5. Полный чек-лист проверки перед началом работы

Перед авторизацией в `claude.ai` или запуском рабочих скриптов с Claude API выполните пошаговую валидацию окружения:

```
[ ] 1. Проверка IPv6
       - Выполнить: ping -6 google.com (должен завершаться ошибкой сети/хост недоступен).
       - Проверить на test-ipv6.com: "No IPv6 address detected".

[ ] 2. Проверка IP-репутации
       - Открыть iphey.com или whoer.net.
       - Убедиться, что статус Anonymity = 100%.
       - Проверить IP на ipqualityscore.com: Fraud Score < 25, Proxy = NO, VPN = NO.
       - Проверить ASN: тип должен быть ISP/Cable/DSL/Residential, но НЕ Hosting/DCH.

[ ] 3. Проверка утечек DNS (DNS Leak Test)
       - Зайти на dnsleaktest.com и запустить Extended Test.
       - В списке серверов должны отображаться ТОЛЬКО сервера США/прокси-провайдера (Cloudflare, Google, ISP).
       - Ни одного сервера из локальной страны присутствия (РФ/Китай/СНГ).

[ ] 4. Проверка утечек WebRTC
       - Проверить на browserleaks.com/webrtc.
       - Public IP Address должен совпадать с IP прокси.
       - Local IP не должен раскрывать локальную сеть клиента (или WebRTC должен быть отключен).

[ ] 5. Проверка доступности Statsig
       - Выполнить проверку резолвинга и ответа: curl -I https://api.statsig.com.
       - Запрос должен успешно проходить через настроенный туннель.
```

---

## Резюме архитектора

Для стабильной, бесперебойной работы с Claude Web и Claude API без внезапных банов и запросов верификации оптимальным решением является:
1. **Транспорт:** **Dedicated ISP Static Residential Proxy** (США, Великобритания, Германия) от проверенного LIR-провайдера.
2. **Сетевой клиент:** **Sing-box в TUN-режиме** или **Clash Verge Rev (Mihomo)** с включенным Fake-IP, DNS-over-HTTPS (1.1.1.1) и полным отключением IPv6.
3. **Маршрутизация:** Маршрутизация по списку доменов, обязательно включающая `statsig.com`, `auth0.com` и сервисы `cloudflare.com`.
4. **Браузерная среда:** Антидетект-браузер с подменой WebRTC на IP прокси и автоматической синхронизацией таймзоны/геолокации по IP.
