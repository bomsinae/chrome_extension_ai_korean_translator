# Selected Text Translator

선택한 문장만 빠르게 한국어로 번역하는 크롬 확장 MVP입니다.

## 기능

- 웹페이지 전체 번역 대신 선택한 문장만 번역
- 문장을 선택하면 바로 아래에 `번역` 버튼 표시
- 버튼을 누르면 선택 문장 아래 말풍선으로 번역 결과 표시
- OpenAI API 키와 모델명을 옵션 페이지에 저장
- 우클릭 메뉴로 번역 진입 유도

## 파일 구조

- `manifest.json`: 확장 설정
- `content.js`: 현재 페이지의 선택 텍스트 감지
- `background.js`: OpenAI API 호출
- `popup.html`, `popup.js`: 번역 UI
- `options.html`, `options.js`: API 키 설정 UI
- `styles.css`: 팝업/설정 화면 스타일

## 설치 방법

1. 크롬에서 `chrome://extensions`를 엽니다.
2. 우측 상단의 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 폴더(`/home/magellan/Projects/translater`)를 선택합니다.

## 사용 방법

1. 확장 옵션 페이지에서 OpenAI API 키를 저장합니다.
2. 번역하고 싶은 문장을 웹페이지에서 선택합니다.
3. 선택 문장 아래에 나타나는 `번역` 버튼을 누릅니다.
4. 선택 문장 아래 말풍선에서 번역 결과를 확인합니다.

## 참고

- 현재는 OpenAI Responses API를 사용합니다.
- 브라우저 확장 안에 API 키를 저장하는 구조라서 MVP 용도에 적합합니다.
- 실제 배포 단계에서는 백엔드 프록시를 두고 API 키를 브라우저에 직접 저장하지 않는 편이 안전합니다.
