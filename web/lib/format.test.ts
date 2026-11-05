import { expect, it } from 'vitest';
import { unescapeText, safeUrl, frameTime, eventTime, runSpan, bytesHuman, ts } from './format';
import { reviewLabel } from './status';

it('repairs nested unicode escapes and preserves lone surrogates', () => {
  expect(unescapeText({
    a: ['x\\u2014y']
  })).toEqual({
    a: ['x—y']
  });
  expect(unescapeText('\\ud83d\\ude00')).toBe('😀');
  expect(unescapeText('\\ud800')).toBe('\\ud800');
});

it.each([
  'javascript:alert(1)',
  '//evil.com/x',
  'data:text/html,x',
  '/\\evil',
  '\\evil',
  '\njavascript:alert(1)',
  'https://a/\tx',
  'relative',
  'https:evil.com',
])('rejects unsafe URL %s', url => {
  expect(safeUrl(url)).toBeUndefined();
});
it.each(['/api/v1/storage/a.mp4', 'https://r2.example/a?b=c', 'http://localhost/a'])('allows URL %s', url => expect(safeUrl(url)).toBe(url));
it('formats frame and unavailable values', () => {
  expect(frameTime(90, 30)).toBe('frame 90 · 0:03');
  expect(frameTime(90, null)).toBe('frame 90');
  expect(bytesHuman(null)).toBe('—');
  expect(bytesHuman(1024)).toBe('1.0 KB');
  expect(ts('bad')).toBe('bad');
  expect(eventTime(null, null, null)).toBe('—');
  expect(runSpan(null, {
    frame_start: null
  })).toBe('whole video');
});
it('uses none for an empty review status', () => {
  expect(reviewLabel('')).toBe('none');
});
