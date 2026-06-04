import vocabData from './vocabulary.json';

export const totalWordsCount = vocabData.words.length;
export const totalPhrasesCount = vocabData.phrases.length;

// Map all vocabulary items to ensure they have a 'tense' property.
// General nouns/elisions have tense = 'any', while verbs have their respective tenses.
const allWords = vocabData.words.map(w => {
  if (w.tense === 'past' || w.tense === 'present' || w.tense === 'future') return w;
  return { ...w, tense: 'any' };
});

const allPhrases = vocabData.phrases.map(p => {
  if (p.tense === 'past' || p.tense === 'present' || p.tense === 'future') return p;
  return { ...p, tense: 'any' };
});

export function getWordsForLevel(level) {
  if (level === 1) {
    // Easy: short general elisions + present tense verbs
    const easyElisions = allWords.filter(w => w.tense === 'any' && w.text.length <= 7).slice(0, 150);
    const presentVerbs = allWords.filter(w => w.tense === 'present').slice(0, 150);
    return [...easyElisions, ...presentVerbs];
  } else if (level === 2) {
    // Medium: medium length general elisions + present & future verbs
    const medElisions = allWords.filter(w => w.tense === 'any' && w.text.length <= 11).slice(0, 250);
    const presFutVerbs = allWords.filter(w => w.tense === 'present' || w.tense === 'future').slice(0, 250);
    return [...medElisions, ...presFutVerbs];
  } else if (level === 3) {
    // Hard: all general elision words + all tenses of verbs
    const allElisions = allWords.filter(w => w.tense === 'any').slice(0, 450);
    const allVerbs = allWords.filter(w => w.tense !== 'any').slice(0, 550);
    return [...allElisions, ...allVerbs];
  } else {
    // Level 4+: Mix of everything, including full phrases
    const mixedPhrases = allPhrases.slice(0, 500);
    return [...allWords, ...mixedPhrases];
  }
}
