# Partner Outsourcing Status Web

반도체 장비 협력사 진행현황을 조회하는 FastAPI 기반 웹 대시보드 프로젝트입니다.

## 1. 주요 기능

- 사용자 로그인
- 관리자 / 협력사 권한 분리
- 메인 대시보드 조회
- Stage 현황 조회
- KPI 카드
- 검색 / 필터 / 정렬 / 컬럼 토글
- WO 상세 모달
- 타임라인 표시
- 데이터 재로딩
- 관리자 사용자 관리
  - 사용자 목록 조회
  - 신규 사용자 추가
  - 사용자 수정
  - 활성 / 비활성 처리
- 본인 비밀번호 변경
- 활동 로그 조회
- 비활성 계정 로그인 차단

---

## 2. 기술 스택

- FastAPI
- Jinja2 Templates
- Supabase
- Pandas / OpenPyXL
- SessionMiddleware

---

## 3. 폴더 구조

```text
app/
  auth.py
  auth_service.py
  activity_log_service.py
  config.py
  data_service.py
  dependencies.py
  main.py
  user_admin_service.py
  data_sources/
    __init__.py
    excel_source.py
    supabase_source.py
  routers/
    __init__.py
    api.py
    pages.py
  static/
  templates/

data/
logs/
scripts/
.env.example
requirements.txt
README.md