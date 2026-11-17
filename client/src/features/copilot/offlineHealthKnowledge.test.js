import { describe, expect, it } from 'vitest';
import { getOfflineAnswer } from './offlineHealthKnowledge.js';

describe('offline oral-health knowledge', () => {
  it.each([
    ['What are the early symptoms of oral cancer?', 'en', 'Warning changes can include'],
    ['నాకు నోటిలో తెల్లటి మచ్చ వచ్చింది. ఏమి చేయాలి?', 'te', 'రెండు వారాల్లో తగ్గని'],
    ['मुंह के कैंसर के शुरुआती लक्षण क्या हैं?', 'hi', 'दो सप्ताह में ठीक न होने वाला'],
    ['ମୁଖ କର୍କଟର ପ୍ରାରମ୍ଭିକ ଲକ୍ଷଣ କ’ଣ?', 'or', 'ଦୁଇ ସପ୍ତାହରେ ଭଲ ନହେଉଥିବା'],
  ])('matches an offline FAQ in %s', (question, language, expected) => {
    expect(getOfflineAnswer(question, language)).toContain(expected);
  });

  it('uses a cautious offline fallback when there is no FAQ match', () => {
    expect(getOfflineAnswer('Can you identify my condition?', 'en')).toContain(
      'I could not find a reliable answer',
    );
  });

  it('directs urgent symptoms to in-person emergency care', () => {
    expect(getOfflineAnswer('I have difficulty breathing', 'en')).toContain(
      'urgent in-person care',
    );
  });
});
