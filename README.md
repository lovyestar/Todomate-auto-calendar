# 투두메이트 캘린더

투두메이트 할 일을 **구독 캘린더(.ics)** 로 만들어 Apple 캘린더 · 삼성 캘린더 · Google 캘린더에 자동으로 띄워 주는 서비스입니다. Cloudflare Workers 위에서 동작합니다.

**사이트:** https://todomate.yestar.dev

> 투두메이트 공식 서비스가 아닌 개인 프로젝트입니다. 비공식 [todomate-api](https://github.com/eheka78/todomate-api)(원본: [3x-haust/todomate-api](https://github.com/3x-haust/todomate-api))를 사용합니다.

## 기능

- 투두메이트 계정으로 한 번 연결하면 전용 캘린더 주소(webcal)를 발급
- 알림 시간이 있는 할 일은 그 시각의 30분 일정, 나머지는 하루 종일 일정
- 지난 할 일 최대 2년 + 앞으로 60일 포함, 완료한 할 일은 ✅ 표시 또는 숨김
- 목표 이름 붙이기(`[운동] 러닝 30분`) 선택
- 같은 계정으로 다시 연결하면 주소는 그대로 유지, 주소 재발급 · 연결 해제 지원
- 연결 만료 3일 전부터 캘린더에 재연결 알림 일정 표시

### 기기별 반영 속도

구독 캘린더는 캘린더 앱이 주기적으로 새로 받아 오는(pull) 방식입니다.

| 기기 | 방법 | 반영 주기 |
| --- | --- | --- |
| 맥 | 캘린더 구독, 자동 새로고침 5분 | 약 5분 |
| 아이폰·아이패드 | webcal 구독 (맥에서 iCloud로 추가하면 공유) | iOS가 결정, 당겨서 새로고침 |
| 갤럭시 | [ICSx⁵](https://play.google.com/store/apps/details?id=at.bitfire.icsdroid) → 삼성 캘린더 | 약 15분 |
| 구글 캘린더 | URL로 추가 | 몇 시간~하루 |

## 구조

```
브라우저 ──▶ todomate.yestar.dev  (이 저장소 루트: 사이트 + .ics 피드 Worker)
                 │  service binding
                 ▼
            todomate-api.yestar.dev  (./api: todomate-api를 Workers로 실행)
                 │
                 ▼
            Firebase Auth / Firestore (투두메이트)
```

| 경로 | 설명 |
| --- | --- |
| `src/index.ts` | 라우터 (`/`, `/feed/<id>.ics`, `/api/connect`, `/api/disconnect`) |
| `src/feed.ts` | 캘린더 생성. `/todos/range`를 최대 62일 단위로 나눠 조회하고 3분 캐시, 실패 시 마지막 정상본 또는 최근 날짜를 하루씩 조회 |
| `src/ics.ts` | iCalendar(RFC 5545) 변환 |
| `src/account.ts` | 연결 · 해제 (로그인 → 토큰 암호화 저장) |
| `src/store.ts` | KV 저장소 (`feed:<id>`, `uid:<uid>`) |
| `src/site/` | 사이트 HTML · 아이콘 · manifest |
| `api/` | [eheka78/todomate-api](https://github.com/eheka78/todomate-api)를 커밋 고정으로 가져와 Workers에서 실행하는 래퍼 |

## 보안

[todomate-api 안전 주의사항](https://github.com/3x-haust/todomate-api/blob/main/README.ko.md#안전-주의사항)을 따릅니다.

- 비밀번호는 저장하지 않습니다. 연결할 때 `/auth/login`에 한 번만 보내고 이후에는 session token만 사용합니다.
- **조회 API만 사용합니다.** 투두 · 알람 쓰기, DM 전송은 호출하지 않습니다(API의 social write도 꺼 둠).
- session token은 AES-GCM(`TOKEN_ENCRYPTION_KEY`)으로 암호화해 KV에만 보관하며 브라우저 · URL에 노출하지 않습니다.
- HTTPS 강제, HSTS, CSP, `Referrer-Policy: no-referrer`, 같은 출처 JSON 요청만 허용, 로그인 시도 IP당 분당 5회 제한.
- 주소 재발급 · 연결 해제 시 기존 token을 버리고 `/auth/logout`을 호출합니다.
- 피드 주소(`/feed/<32자 랜덤>.ics`)가 곧 읽기 권한이므로 공유하지 않도록 안내합니다.

## 직접 배포하기

필요한 것: Node.js 22.18+, Cloudflare 계정, Cloudflare에 연결된 도메인.

```bash
git clone <this repo> && cd todomate-calendar
npm ci && npm --prefix api ci
npx wrangler login
```

1. **API Worker** (`api/wrangler.toml`의 도메인을 바꾼 뒤)

   ```bash
   cd api
   npx wrangler deploy
   # 투두메이트 웹앱(www.todomate.net)의 공개 Firebase web API key
   npx wrangler secret put TODOMATE_FIREBASE_API_KEY
   openssl rand -hex 32 | npx wrangler secret put SESSION_ENCRYPTION_KEY
   cd ..
   ```

2. **캘린더 Worker** (`wrangler.toml`의 도메인 · KV id를 바꾼 뒤)

   ```bash
   npx wrangler kv namespace create FEEDS      # 나온 id를 wrangler.toml에 기록
   npx wrangler deploy
   openssl rand -hex 32 | npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```

### GitHub Actions

- `CI`: 모든 push/PR에서 타입 체크, 테스트, 두 Worker 빌드(dry run)
- `Deploy`: `main` push 시 두 Worker 배포. 저장소 변수 `DEPLOY_ENABLED=true`와 시크릿 `CLOUDFLARE_API_TOKEN`(Workers 편집 권한), `CLOUDFLARE_ACCOUNT_ID`를 설정하면 켜집니다. Worker 시크릿은 위 `wrangler secret put`으로 한 번만 넣으면 유지됩니다.

### 설정 (`wrangler.toml` `[vars]`)

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `FUTURE_DAYS` | `60` | 피드에 포함할 앞으로의 일수 |
| `CACHE_SECONDS` | `180` | 생성한 캘린더 캐시 시간 |
| `TIMEZONE` | `Asia/Seoul` | "오늘" 기준 시간대 |
| `TODOMATE_API_BASE_URL` | `https://todomate-api.yestar.dev` | service binding이 없을 때 쓰는 API 주소 |

API 쪽 `SESSION_TTL_DAYS`(기본 90)는 다시 연결해야 하는 주기입니다.

## 개발

```bash
npm run check          # 타입 체크 + 테스트
cp .dev.vars.example .dev.vars && npm run dev
```

## 제한 사항

- 비공식 API라 투두메이트가 내부 구조를 바꾸면 동작하지 않을 수 있습니다.
- `/todos/range`가 실패하면 최근 7일 ~ 앞으로 30일만 하루씩 조회해 보여 줍니다.
- Workers Free 플랜의 CPU 제한(요청당 10ms) 때문에 "2년" 범위에 할 일이 아주 많으면 피드 생성이 한도에 가까워질 수 있습니다.
- 카카오톡 톡캘린더는 외부 .ics 구독을 지원하지 않습니다.

## 라이선스

MIT. 사용하는 todomate-api도 MIT 라이선스입니다.
