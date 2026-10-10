import test from 'node:test';
import assert from 'node:assert/strict';
import {changeTimelineRange} from '../static/timeline-range.js';
test('either zoom handle keeps the opposite edge anchored', () => {
 assert.deepEqual(changeTimelineRange(10,30,'left',5,100,2),{start:15,end:30});
 assert.deepEqual(changeTimelineRange(10,30,'right',-5,100,2),{start:10,end:25});
});
test('handles cannot cross or extend beyond the timeline', () => {
 assert.deepEqual(changeTimelineRange(10,30,'left',100,100,2),{start:28,end:30});
 assert.deepEqual(changeTimelineRange(10,30,'right',-100,100,2),{start:10,end:12});
 assert.deepEqual(changeTimelineRange(10,30,'left',-100,100,2),{start:0,end:30});
 assert.deepEqual(changeTimelineRange(10,30,'right',100,100,2),{start:10,end:100});
});
test('panning preserves zoom and stops at either end', () => {
 assert.deepEqual(changeTimelineRange(10,30,'pan',20,100,2),{start:30,end:50});
 assert.deepEqual(changeTimelineRange(10,30,'pan',100,100,2),{start:80,end:100});
 assert.deepEqual(changeTimelineRange(10,30,'pan',-100,100,2),{start:0,end:20});
});
