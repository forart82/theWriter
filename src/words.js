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

export function getWordsForLevel(level) {
  if (level === 1) {
    // Easy: short words (length <= 7)
    return allWords.filter(w => w.text.length <= 7);
  } else if (level === 2) {
    // Medium: words with length <= 11
    return allWords.filter(w => w.text.length <= 11);
  } else if (level === 3) {
    // Hard: all filtered words
    return allWords;
  } else {
    // Level 4+: Mix of words and phrases
    return [...allWords, ...allPhrases];
  }
}

