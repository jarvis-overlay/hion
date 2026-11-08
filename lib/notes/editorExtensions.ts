// 업무수첩 Tiptap 확장 목록. 에디터(쓰기용)와 변경 이력 뷰(읽기전용)가 이
// 배열을 그대로 재사용해야 한다 - 양쪽이 다른 확장 세트를 쓰면 과거 저장된
// 문서(JSON)를 읽기 화면이 못 그리거나 다르게 그리는 문제가 생긴다.
//
// 설치된 Tiptap이 v3라 StarterKit이 Underline을 기본 포함한다 - 아래에서
// 따로 Underline을 추가하므로 StarterKit 쪽은 꺼서 "같은 이름 확장 중복"
// 경고/충돌을 피한다. "글자 크기"도 v2 시절엔 공식 확장이 없어 TextStyle을
// 직접 확장해야 했지만, 설치된 v3의 @tiptap/extension-text-style 패키지가
// 공식 FontSize 확장을 이미 포함하고 있어 그걸 그대로 쓴다(직접 만든 확장과
// 동작은 동일하고, 중복 구현을 피할 수 있다).
import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { CharacterCount } from '@tiptap/extension-character-count';

// saveNote 서버 액션의 하드 가드(500,000자)와 반드시 맞춰야 한다.
export const NOTE_BODY_CHAR_LIMIT = 500_000;

export const noteEditorExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    underline: false,
  }),
  Underline,
  Highlight.configure({ multicolor: true }),
  TextStyle,
  FontSize,
  Color,
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: '내용을 입력하세요...' }),
  CharacterCount.configure({ limit: NOTE_BODY_CHAR_LIMIT }),
];
