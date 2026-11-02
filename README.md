# Todomate Auto Calendar

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020.svg?logo=cloudflare)](https://workers.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6.svg?logo=typescript)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-22.18+-339933.svg?logo=nodedotjs)](https://nodejs.org)
[![CI](https://github.com/lovyestar/Todomate-auto-calendar/actions/workflows/ci.yml/badge.svg)](https://github.com/lovyestar/Todomate-auto-calendar/actions/workflows/ci.yml)
[![GitHub](https://img.shields.io/github/license/lovyestar/Todomate-auto-calendar)](LICENSE)
[![Site](https://img.shields.io/badge/site-todomate.yestar.dev-1D1B17.svg)](https://todomate.yestar.dev)

### Todomate todos as a subscribable calendar (iCalendar)

---

* #### Features
    * 투두메이트 할 일을 구독 캘린더(.ics)로 제공
    * 목표(카테고리)별 캘린더 분리
    * 메모 포함, 알림 시간이 있는 할 일은 시간 일정으로 변환
    * 지난 할 일 최대 2년 + 앞으로 60일
    * 비밀번호 미저장, 읽기 전용
* #### Supported calendars
    * Apple 캘린더 (iPhone, iPad, Mac)
    * 삼성 캘린더 ([ICSx⁵](https://play.google.com/store/apps/details?id=at.bitfire.icsdroid) 경유)
    * Google 캘린더

---

투두메이트에는 캘린더로 내보내는 기능이 없습니다.  
할 일은 투두메이트에, 약속은 캘린더 앱에 적다 보면 하루 일정을 보기 위해 두 앱을 번갈아 열게 됩니다.

할 일을 캘린더에서도 보고 싶다면 하나씩 옮겨 적는 수밖에 없고, 할 일을 고치거나 완료할 때마다 캘린더도 같이 고쳐야 합니다.

그래서 투두메이트에 적기만 하면 캘린더에도 알아서 들어오는 방법이 필요해졌습니다.

Todomate Auto Calendar는 투두메이트 계정을 한 번 연결하면 전용 캘린더 주소를 만들어 주고, 캘린더 앱은 그 주소를 주기적으로 받아 와 할 일을 그대로 보여 줍니다.

---

아래와 같은 할 일이 있다고 생각해봅시다.

* 운동
    * 아침 러닝 30분 \<메모: 한강 5km>
* 업무
    * 주간 회의 준비 \<알림: 09:30>

캘린더에는 다음과 같이 들어갑니다.

```text
BEGIN:VEVENT
SUMMARY:[운동] 아침 러닝 30분
DTSTART;VALUE=DATE:20261102          ← 알림이 없으면 하루 종일 일정
DESCRIPTION:한강 5km                  ← 메모는 일정의 메모란으로
CATEGORIES:운동
END:VEVENT

BEGIN:VEVENT
SUMMARY:[업무] 주간 회의 준비
DTSTART:20261102T003000Z             ← 알림 시각에 30분 일정 (09:30 KST)
DTEND:20261102T010000Z
CATEGORIES:업무
END:VEVENT
```

목표마다 주소가 따로 있어서, 필요한 목표만 골라 구독할 수 있습니다.

```text
https://todomate.yestar.dev/feed/<id>.ics            전체 할 일
https://todomate.yestar.dev/feed/<id>/<goalId>.ics   해당 목표의 할 일만
```

목표별로 구독하면 캘린더 앱에서 목표마다 색을 다르게 정하고 켜고 끌 수 있습니다.

---

### Usage

1. [todomate.yestar.dev](https://todomate.yestar.dev)에서 투두메이트 계정으로 연결합니다.
2. 기기에 맞는 버튼으로 캘린더에 추가합니다.

| 기기 | 방법 | 반영 주기 |
| --- | --- | --- |
| Mac | 캘린더 구독, 자동 새로고침 5분 | 약 5분 |
| iPhone · iPad | webcal 구독 | iOS가 결정 |
| Galaxy | ICSx⁵ → 삼성 캘린더 | 약 15분 |
| Google 캘린더 | URL로 추가 | 수 시간 |

### Structure

```text
browser ──▶ todomate.yestar.dev       사이트 + .ics 피드 (루트)
                │ service binding
                ▼
            todomate-api.yestar.dev   todomate-api를 Workers로 실행 (./api)
                │
                ▼
            Firebase Auth / Firestore (투두메이트)
```

* `src/feed.ts` `/todos/range`를 62일 단위로 나눠 조회, 계정별로 3분 캐시
* `src/ics.ts` iCalendar(RFC 5545) 변환
* `src/account.ts` 연결 · 해제 · 목표 목록
* `src/site/` 사이트
* `api/` [eheka78/todomate-api](https://github.com/eheka78/todomate-api)를 커밋 고정으로 가져와 실행하는 래퍼

### Self-hosting

Cloudflare 계정과 Cloudflare에 연결된 도메인이 필요합니다. 두 `wrangler.toml`의 도메인과 KV id를 바꾼 뒤 진행합니다.

```bash
npm ci && npm --prefix api ci
npx wrangler login
```

```bash
# API
cd api
npx wrangler deploy
npx wrangler secret put TODOMATE_FIREBASE_API_KEY   # www.todomate.net의 공개 Firebase web API key
openssl rand -hex 32 | npx wrangler secret put SESSION_ENCRYPTION_KEY
cd ..
```

```bash
# 사이트 + 피드
npx wrangler kv namespace create FEEDS                # 나온 id를 wrangler.toml에 기록
npx wrangler deploy
openssl rand -hex 32 | npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

`main`에 push할 때 자동으로 배포하려면 저장소 변수 `DEPLOY_ENABLED=true`, 시크릿 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`를 설정합니다.

### Development

```bash
npm run check                                   # 타입 체크 + 테스트
cp .dev.vars.example .dev.vars && npm run dev
```

---

### NOTE

* 비밀번호는 저장하지 않습니다. 연결할 때 한 번만 로그인에 쓰고, 받은 session token은 AES-GCM으로 암호화해 KV에 보관합니다.
* 할 일 · 알람 쓰기, DM 전송 등 쓰기 API는 호출하지 않습니다.
* 피드 주소가 곧 읽기 권한입니다. 노출됐다면 사이트에서 주소를 새로 발급합니다.
* 연결은 90일 동안 유지되며, 만료 3일 전부터 캘린더에 재연결 알림 일정이 생깁니다.
* 투두메이트 내부 구조가 바뀌면 todomate-api와 함께 동작하지 않을 수 있습니다.
* 카카오톡 톡캘린더는 외부 .ics 구독을 지원하지 않습니다.
* 라이선스는 MIT입니다.

### Credits

* **[3x-haust/todomate-api](https://github.com/3x-haust/todomate-api)**
    * 투두메이트 HTTP API
* **[eheka78/todomate-api](https://github.com/eheka78/todomate-api)**
    * 기간별 투두 조회 (`/todos/range`)
    * Firebase 토큰 재사용
