// 이미지 규격 - 화면과 서버가 같은 숫자를 쓰도록 한 곳에 모아둔다 (sharp/canvas를 가져오지 않아서
// 클라이언트 컴포넌트에서도 import 할 수 있다).
//
// 상세페이지: 가로는 항상 860px 고정. 세로는 장면 종류별로 아래 값으로 정한다.
//   - 사진이 있는 장면 : 사진 영역의 세로가 고정 (글자가 위에 얹히는 장면 860x1075, 문구 + 사진 장면은 문구 영역 + 860x860)
//   - 사진 없는 장면   : 내용에 맞춰 정하되 최소 높이 이상
//   - 사이즈표/사양표  : 행 수에 맞춰 정함
// 모든 장면은 마지막에 가로 860px인지 검사하고, 아니면 장면을 실패로 처리한다 (잘못된 규격이 조용히 나가지 않게).
export const DETAIL_IMAGE_WIDTH = 860;
export const DETAIL_OVERLAY_HEIGHT = 1075; // 4:5
export const DETAIL_PHOTO_HEIGHT = 860; // 문구 + 사진 장면의 사진 영역 (1:1)
export const DETAIL_MIN_HEIGHT = 560; // 사진 없는 장면의 최소 높이

// 이어붙인 긴 이미지 한 장의 최대 세로 길이 (장면 경계에서 나눈다)
export const DETAIL_STITCH_MAX_HEIGHT = 10000;

// 썸네일(메인/추가 이미지)
export const THUMBNAIL_IMAGE_SIZE = 1000;

export const DETAIL_SPEC_TEXT = `가로 ${DETAIL_IMAGE_WIDTH}px 고정 · JPEG · 사진 장면 세로 ${DETAIL_PHOTO_HEIGHT}~${DETAIL_OVERLAY_HEIGHT}px`;
