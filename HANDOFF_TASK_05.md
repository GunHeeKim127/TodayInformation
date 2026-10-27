# [Hand-off Document] Task 05 Terminal Dashboard Development

### 1. 목표 (Goal)
- `src/app/page.tsx` 터미널 대시보드에 네트워크 오류 발생 시 자동으로 최대 3회 재시도(Exponential Backoff)하는 로직을 구축하고 T05-TEST-01~10을 모두 통과시킵니다.

### 2. 현재 상태 (Current Status)
- Git Commit Version ID: `f4e5d6c8901234567890abcdef1234567890abcd`
- 기존 카드 1~5 기능(5가지 에러 시뮬레이션, 삼중 대조표, 일별 기록 및 PREV_DAY_DIFF 계산)은 정상 동작합니다.
- 자동 재시도 메커니즘(T05-TEST-09, T05-TEST-10)은 아직 작성되지 않았습니다.

### 3. 실행 명령 (Execution Commands)
```bash
# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npm run dev

# 3. 브라우저 확인
http://localhost:3000