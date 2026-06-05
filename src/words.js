import vocabData from './vocabulary.json';

// Filter vocabulary to only keep elisions (containing ') and verbs (tense is 'past', 'present', or 'future')
const allWords = vocabData.words.filter(w => 
  w.text.includes("'") || 
  w.tense === 'past' || 
  w.tense === 'present' || 
  w.tense === 'future'
);

const allPhrases = vocabData.phrases.filter(p => 
  p.text.includes("'") || 
  p.tense === 'past' || 
  p.tense === 'present' || 
  p.tense === 'future'
);

export const totalWordsCount = allWords.length;
export const totalPhrasesCount = allPhrases.length;

// Combine words and phrases to mix them up at all levels
const combinedPool = [...allWords, ...allPhrases];

export function getWordsForLevel(level) {
  if (level === 1) {
    // Wave 1: short words and phrases (length <= 9)
    return combinedPool.filter(w => w.text.length <= 9);
  } else if (level === 2) {
    // Wave 2: medium words and phrases (length <= 14)
    return combinedPool.filter(w => w.text.length <= 14);
  } else if (level === 3) {
    // Wave 3: longer words and phrases (length <= 20)
    return combinedPool.filter(w => w.text.length <= 20);
  } else {
    // Wave 4+: all lengths mixed
    return combinedPool;
  }
}


