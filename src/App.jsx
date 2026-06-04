import { useState, useEffect, useRef } from 'react';
import { 
  Trophy, 
  Target, 
  Flame, 
  Zap, 
  Settings, 
  Volume2, 
  Play, 
  Pause, 
  RefreshCw, 
  HelpCircle, 
  CheckCircle, 
  AlertCircle,
  ArrowRight,
  Info,
  Calendar,
  LogIn,
  LogOut
} from 'lucide-react';
import { getWordsForLevel, totalWordsCount, totalPhrasesCount } from './words';
import './App.css'; // kept for clean loading, but index.css does the heavy lifting
import { db, auth, googleProvider } from './firebase';
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// Fisher-Yates array shuffling utility
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export default function App() {
  // Game Setup & Modes
  const [gameMode, setGameMode] = useState('dashboard'); // 'dashboard', 'elision', 'tense'
  const [userId, setUserId] = useState('');
  const [user, setUser] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  // Game Stats
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [level, setLevel] = useState(1);
  const [wordsAttempted, setWordsAttempted] = useState(0);
  const [wordsCorrect, setWordsCorrect] = useState(0);
  
  // Floating Items & Particles
  const [floatingWords, setFloatingWords] = useState([]);
  const [particles, setParticles] = useState([]);
  
  // Inputs
  const [typedText, setTypedText] = useState('');
  const [tenseInputs, setTenseInputs] = useState({ past: '', present: '', future: '' });
  
  // Typing Accuracy Tracking per word
  const [errorsThisWord, setErrorsThisWord] = useState(0);
  const [lastCheckedInput, setLastCheckedInput] = useState('');
  const [inputState, setInputState] = useState('normal'); // 'normal', 'error', 'correct'
  const [tenseInputStates, setTenseInputStates] = useState({ past: 'normal', present: 'normal', future: 'normal' });

  // Notifications & Modals
  const [notification, setNotification] = useState(null);
  const [showGameOver, setShowGameOver] = useState(false);
  const [reviewWords, setReviewWords] = useState([]);
  const [history, setHistory] = useState([]);
  
  // Sound & Speech Synthesis
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speechRate, setSpeechRate] = useState(0.65); // Default slowed down for learning
  const [speechPitch, setSpeechPitch] = useState(1.0);
  const [ttsEngine, setTtsEngine] = useState('cloud'); // 'cloud' (Google Translate), 'openai' (Puter AI), 'local' (Browser Native)
  const [minWordSpeed, setMinWordSpeed] = useState(0.8);
  const [maxWordSpeed, setMaxWordSpeed] = useState(1.4);
  
  // Refs
  const inputRef = useRef(null);
  const tenseRefs = {
    past: useRef(null),
    present: useRef(null),
    future: useRef(null)
  };
  const wordIdRef = useRef(0);
  const notificationTimeoutRef = useRef(null);
  
  const floatingWordsRef = useRef([]);
  const levelRef = useRef(1);
  const gameModeRef = useRef('dashboard');
  const passedWordsRef = useRef(new Set());

  // Keep refs in sync to avoid stale closures in spawning intervals
  useEffect(() => {
    floatingWordsRef.current = floatingWords;
  }, [floatingWords]);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    gameModeRef.current = gameMode;
  }, [gameMode]);

  // Clear passed words tracker when level changes during play
  useEffect(() => {
    if (isPlaying) {
      passedWordsRef.current.clear();
    }
  }, [level, isPlaying]);

  // Google Authentication Handlers
  const handleSignInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      triggerNotification("Connexion réussie !", "success");
    } catch (e) {
      console.error("Google Sign-In failed", e);
      triggerNotification("Échec de la connexion", "error");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      triggerNotification("Déconnexion réussie", "success");
    } catch (e) {
      console.error("Sign-Out failed", e);
    }
  };

  // Load settings from Firestore
  const loadSettingsFromFirestore = async (uid) => {
    try {
      const docRef = doc(db, 'users', uid, 'config', 'settings');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.speechRate !== undefined) setSpeechRate(data.speechRate);
        if (data.speechPitch !== undefined) setSpeechPitch(data.speechPitch);
        if (data.selectedVoice !== undefined) setSelectedVoice(data.selectedVoice);
        if (data.ttsEngine !== undefined) setTtsEngine(data.ttsEngine);
        if (data.minWordSpeed !== undefined) setMinWordSpeed(data.minWordSpeed);
        if (data.maxWordSpeed !== undefined) setMaxWordSpeed(data.maxWordSpeed);
      }
    } catch (e) {
      console.warn("Could not load settings from Firestore, using local defaults", e);
    }
  };

  // Save settings to Firestore
  const saveSettingsToFirestore = async (uid, settingsUpdate) => {
    try {
      const docRef = doc(db, 'users', uid, 'config', 'settings');
      await setDoc(docRef, settingsUpdate, { merge: true });
    } catch (e) {
      console.warn("Could not save settings to Firestore", e);
    }
  };

  // Load history from Firestore
  const loadHistoryFromFirestore = async (uid) => {
    try {
      const colRef = collection(db, 'users', uid, 'history');
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(10));
      const querySnapshot = await getDocs(q);
      const items = [];
      querySnapshot.forEach((doc) => {
        items.push(doc.data());
      });
      if (items.length > 0) {
        setHistory(items);
      }
    } catch (e) {
      console.warn("Could not load history from Firestore", e);
    }
  };

  // Save history item to Firestore
  const saveHistoryToFirestore = async (uid, session) => {
    try {
      const colRef = collection(db, 'users', uid, 'history');
      await addDoc(colRef, {
        ...session,
        timestamp: new Date().getTime()
      });
    } catch (e) {
      console.warn("Could not save session history to Firestore", e);
    }
  };

  // Load history and configuration on mount with Auth integration
  useEffect(() => {
    // Initial load of defaults from local storage
    const savedHistory = localStorage.getItem('thewriter_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse game history', e);
      }
    }

    const savedRate = localStorage.getItem('thewriter_speech_rate');
    if (savedRate) setSpeechRate(parseFloat(savedRate));
    const savedPitch = localStorage.getItem('thewriter_speech_pitch');
    if (savedPitch) setSpeechPitch(parseFloat(savedPitch));
    
    const savedTtsEngine = localStorage.getItem('thewriter_tts_engine');
    if (savedTtsEngine) setTtsEngine(savedTtsEngine);
    const savedMinSpeed = localStorage.getItem('thewriter_min_word_speed');
    if (savedMinSpeed !== null) setMinWordSpeed(parseFloat(savedMinSpeed));
    const savedMaxSpeed = localStorage.getItem('thewriter_max_word_speed');
    if (savedMaxSpeed !== null) setMaxWordSpeed(parseFloat(savedMaxSpeed));

    // Listen to Firebase Auth state changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setUserId(currentUser.uid);
        loadSettingsFromFirestore(currentUser.uid);
        loadHistoryFromFirestore(currentUser.uid);
      } else {
        setUser(null);
        let uid = localStorage.getItem('thewriter_uid');
        if (!uid) {
          uid = 'user_' + Math.random().toString(36).substring(2, 11);
          localStorage.setItem('thewriter_uid', uid);
        }
        setUserId(uid);
        loadSettingsFromFirestore(uid);
        loadHistoryFromFirestore(uid);
      }
    });

    // Speech Synthesis initialization
    if ('speechSynthesis' in window) {
      const getSpeechVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        setVoices(availableVoices);
        
        // Find default french voice
        const savedVoice = localStorage.getItem('thewriter_selected_voice');
        if (savedVoice) {
          setSelectedVoice(savedVoice);
        } else {
          const defaultFr = availableVoices.find(v => v.lang.startsWith('fr'));
          if (defaultFr) {
            setSelectedVoice(defaultFr.voiceURI);
          }
        }
      };

      getSpeechVoices();
      window.speechSynthesis.onvoiceschanged = getSpeechVoices;
    }

    return () => unsubscribe();
  }, []);

  // Sync settings to localStorage and Firestore
  const handleRateChange = (rate) => {
    setSpeechRate(rate);
    localStorage.setItem('thewriter_speech_rate', rate);
    if (userId) saveSettingsToFirestore(userId, { speechRate: rate });
  };

  const handlePitchChange = (pitch) => {
    setSpeechPitch(pitch);
    localStorage.setItem('thewriter_speech_pitch', pitch);
    if (userId) saveSettingsToFirestore(userId, { speechPitch: pitch });
  };

  const handleVoiceChange = (voiceURI) => {
    setSelectedVoice(voiceURI);
    localStorage.setItem('thewriter_selected_voice', voiceURI);
    if (userId) saveSettingsToFirestore(userId, { selectedVoice: voiceURI });
  };

  const handleTtsEngineChange = (engine) => {
    setTtsEngine(engine);
    localStorage.setItem('thewriter_tts_engine', engine);
    if (userId) saveSettingsToFirestore(userId, { ttsEngine: engine });
  };

  const handleMinWordSpeedChange = (val) => {
    setMinWordSpeed(val);
    localStorage.setItem('thewriter_min_word_speed', val);
    let updatedMax = maxWordSpeed;
    if (val > maxWordSpeed) {
      updatedMax = val;
      setMaxWordSpeed(val);
      localStorage.setItem('thewriter_max_word_speed', val);
    }
    if (userId) saveSettingsToFirestore(userId, { minWordSpeed: val, maxWordSpeed: updatedMax });
  };

  const handleMaxWordSpeedChange = (val) => {
    setMaxWordSpeed(val);
    localStorage.setItem('thewriter_max_word_speed', val);
    let updatedMin = minWordSpeed;
    if (val < minWordSpeed) {
      updatedMin = val;
      setMinWordSpeed(val);
      localStorage.setItem('thewriter_min_word_speed', val);
    }
    if (userId) saveSettingsToFirestore(userId, { maxWordSpeed: val, minWordSpeed: updatedMin });
  };

  // Text-To-Speech Pronunciation with Cloud voice option
  const speakWord = (text, slow = false) => {
    const rate = slow ? speechRate * 0.8 : speechRate;
    
    if (ttsEngine === 'openai' && window.puter) {
      // Use OpenAI high-fidelity neural voice via Puter.js
      window.puter.ai.txt2speech(text, { provider: 'openai', language: 'fr-FR' })
        .then(audioObj => {
          if (audioObj) {
            audioObj.preservesPitch = true;
            audioObj.mozPreservesPitch = true;
            audioObj.webkitPreservesPitch = true;
            audioObj.playbackRate = rate;
            audioObj.play();
          }
        })
        .catch(err => {
          console.warn("OpenAI Puter TTS failed, falling back to Google Cloud", err);
          speakGoogleWord(text, rate);
        });
    } else if (ttsEngine === 'cloud' || ttsEngine === 'openai') {
      speakGoogleWord(text, rate);
    } else {
      speakLocalWord(text, rate);
    }
  };

  const speakGoogleWord = (text, rate) => {
    // Google Translate TTS cloud voice for perfect French articulation
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=fr&client=tw-ob&q=${encodeURIComponent(text)}`;
    const audio = new Audio(url);
    
    // CRITICAL: Preserve pitch so it sounds natural at slower speeds!
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.playbackRate = rate;
    
    audio.play().catch(err => {
      console.warn("Google Cloud TTS failed, falling back to local speech engine", err);
      speakLocalWord(text, rate);
    });
  };

  const speakLocalWord = (text, rate) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      
      const voice = voices.find(v => v.voiceURI === selectedVoice);
      if (voice) {
        utterance.voice = voice;
      }
      
      utterance.rate = rate;
      utterance.pitch = speechPitch;
      
      window.speechSynthesis.speak(utterance);
    }
  };

  // Audio test trigger
  const handleTestVoice = () => {
    speakWord("Bonjour ! Bienvenue dans l'application l'Écrivain.");
  };

  // Dynamic Notification Helper
  const triggerNotification = (message, type) => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setNotification({ message, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Core Word Generator
  const spawnWord = () => {
    const currentLevel = levelRef.current;
    const vocab = getWordsForLevel(currentLevel);
    if (!vocab || vocab.length === 0) return;

    // Filter out words that have already been passed
    let available = vocab.filter(w => !passedWordsRef.current.has(w.text));

    // If all words have been passed, reset the passed words set
    if (available.length === 0) {
      passedWordsRef.current.clear();
      available = vocab;
    }

    // Attempt to avoid spawning a word that is currently floating on screen
    const currentFloatingTexts = new Set(floatingWordsRef.current.map(w => w.text));
    const nonFloatingAvailable = available.filter(w => !currentFloatingTexts.has(w.text));
    if (nonFloatingAvailable.length > 0) {
      available = nonFloatingAvailable;
    }

    // Select a random word from the available list
    const randomIndex = Math.floor(Math.random() * available.length);
    const picked = available[randomIndex];
    if (!picked) return;

    // Record that this word has been passed
    passedWordsRef.current.add(picked.text);

    // Calculate speed based on level and min/max speed settings
    const levelFactor = 1 + currentLevel * 0.05;
    const baseMin = 0.05 * minWordSpeed * levelFactor;
    const baseMax = 0.15 * maxWordSpeed * levelFactor;
    
    // Ensure min < max
    const speedRangeMin = baseMin;
    const speedRangeMax = Math.max(baseMin + 0.01, baseMax);
    const speed = speedRangeMin + Math.random() * (speedRangeMax - speedRangeMin);

    wordIdRef.current += 1;
    const newWord = {
      id: wordIdRef.current,
      text: picked.text,
      translation: picked.translation,
      tense: picked.tense || 'any', // default to any for general words
      x: 95, // starts at the right edge
      y: Math.max(15, Math.min(80, 15 + Math.random() * 65)), // random vertical position
      speed: speed,
      errors: 0
    };

    setFloatingWords(prev => [...prev, newWord]);
  };

  // Spawning logic interval
  useEffect(() => {
    if (!isPlaying || isPaused || showGameOver) return;

    let lastSpawnTime = Date.now();
    
    // Check every 500ms if we should spawn another word
    const interval = setInterval(() => {
      const maxWords = Math.min(6, 3 + Math.floor(level / 2));
      const currentFloating = floatingWordsRef.current;
      
      const spawnIntervalTime = Math.max(2000, 5000 - level * 400);
      const timeSinceLastSpawn = Date.now() - lastSpawnTime;

      // Spawn if board has 0 words, or if we have fewer than maxWords and the interval has elapsed
      if (currentFloating.length === 0 || (currentFloating.length < maxWords && timeSinceLastSpawn >= spawnIntervalTime)) {
        spawnWord();
        lastSpawnTime = Date.now();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, isPaused, showGameOver, level]);

  // Coordinate updates / Physics loop (requestAnimationFrame)
  useEffect(() => {
    if (!isPlaying || isPaused || showGameOver) return;
    
    let lastTime = performance.now();
    let animationFrameId;
    
    const gameTick = (time) => {
      const delta = (time - lastTime) / 1000;
      lastTime = time;
      
      setFloatingWords(prev => {
        let hasCrashed = false;
        let crashedWord = null;
        
        // Update position of words
        const updated = prev.map(w => {
          // Normalize update rate to 60fps
          const speedFactor = delta * 60;
          return {
            ...w,
            x: w.x - (w.speed * speedFactor)
          };
        }).filter(w => {
          if (w.x < -10) {
            hasCrashed = true;
            crashedWord = w;
            return false; // remove crashed word
          }
          return true;
        });

        if (hasCrashed && crashedWord) {
          // Trigger crash callbacks asynchronously
          setTimeout(() => {
            handleWordCrash(crashedWord);
          }, 0);
        }

        return updated;
      });

      animationFrameId = requestAnimationFrame(gameTick);
    };

    animationFrameId = requestAnimationFrame(gameTick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, isPaused, showGameOver, level]);

  // Handle word crash (reached left edge)
  const handleWordCrash = (word) => {
    setStreak(0);
    setScore(prev => Math.max(0, prev - 30));
    setWordsAttempted(prev => prev + 1);
    
    // Add to review list
    setReviewWords(prev => {
      if (prev.some(rw => rw.text === word.text)) return prev;
      return [...prev, word];
    });

    triggerNotification(`Manqué ! "${word.text}" = "${word.translation}"`, 'missed');
    
    // Speak word slowly for auditory correction
    speakWord(word.text, true);

    // If score or progress reaches threshold, check game over parameters
    // In this practice mode, game keeps going but streak resets.
    // However, if we accumulate more than 8 words in review, let's offer to pause/game over to review
    if (reviewWords.length >= 7) {
      endGame();
    }
  };

  // Spark / Particle Burst Generator
  const createExplosion = (x, y, colorClass) => {
    let particleColor = '#8b5cf6'; // default violet
    if (colorClass === 'past') particleColor = '#ec4899';
    else if (colorClass === 'present') particleColor = '#10b981';
    else if (colorClass === 'future') particleColor = '#06b6d4';

    const newParticles = Array.from({ length: 15 }).map((_, i) => {
      const angle = (i / 15) * Math.PI * 2 + (Math.random() * 0.5);
      const speed = 2 + Math.random() * 6;
      return {
        id: Math.random(),
        x: `${x}%`,
        y: `${y}%`,
        dx: `${Math.cos(angle) * speed * 25}px`,
        dy: `${Math.sin(angle) * speed * 25}px`,
        size: `${3 + Math.random() * 6}px`,
        color: particleColor
      };
    });

    setParticles(prev => [...prev, ...newParticles]);
    
    // Cleanup particles
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newParticles.some(np => np.id === p.id)));
    }, 6000);
  };

  // Keypress Accuracy Validator & Handler (Unified Input)
  const handleInputChange = (e) => {
    const text = e.target.value;
    setTypedText(text);
    
    if (text === '') {
      setInputState('normal');
      return;
    }

    // Check prefix match against all active words
    const isPrefixOfAny = floatingWords.some(w => 
      w.text.toLowerCase().startsWith(text.toLowerCase())
    );

    if (!isPrefixOfAny) {
      setInputState('error');
      if (text.length > lastCheckedInput.length) {
        setErrorsThisWord(prev => prev + 1);
      }
    } else {
      setInputState('normal');
    }

    setLastCheckedInput(text);

    // Check exact match
    const matchingWord = floatingWords.find(w => w.text.toLowerCase() === text.trim().toLowerCase());
    
    if (matchingWord) {
      // Find current column of the word based on X coordinate
      // Boundaries: Past (0 - 33.3), Present (33.3 - 66.6), Future (66.6 - 100)
      const currentWordColumn = matchingWord.x < 33.3 ? 'past' : (matchingWord.x < 66.6 ? 'present' : 'future');
      
      const isMatchable = matchingWord.tense === 'any' || currentWordColumn === matchingWord.tense;
      
      if (isMatchable) {
        handleWordSolved(matchingWord, matchingWord.tense === 'any' ? 'any' : matchingWord.tense);
        setTypedText('');
        setInputState('correct');
        setTimeout(() => setInputState('normal'), 200);
      } else {
        // Tense does not match current physical column
        setInputState('error');
        setErrorsThisWord(prev => prev + 1);
        
        let tenseFr = matchingWord.tense === 'past' ? 'PASSÉ (gauche)' : (matchingWord.tense === 'present' ? 'PRÉSENT (milieu)' : 'FUTUR (droite)');
        triggerNotification(`Mauvaise zone ! "${matchingWord.text}" est au ${tenseFr}`, 'missed');
      }
    }
  };

  // Word Solved successfully
  const handleWordSolved = (word, highlightColor) => {
    speakWord(word.text);
    createExplosion(word.x, word.y, highlightColor);
    
    // Remove the word
    setFloatingWords(prev => prev.filter(w => w.id !== word.id));
    
    // Calculate stats
    setWordsCorrect(prev => prev + 1);
    setWordsAttempted(prev => prev + 1);
    
    const newStreak = streak + 1;
    setStreak(newStreak);

    // Score calculations
    // Base score: 100
    // Error deduction: -15 per error (minimum 20 points)
    // Speed bonus: up to 150 points depending on how fast they typed (closer to x = 95 is faster)
    const baseVal = Math.max(20, 100 - (errorsThisWord * 15));
    const speedBonus = Math.round(word.x * 1.5);
    const scoreGain = Math.round((baseVal + speedBonus) * (1 + newStreak * 0.05));
    
    setScore(prev => prev + scoreGain);
    setErrorsThisWord(0);

    // Level progression
    // Trigger level up every 5 solved words in streak, or 10 total correct words
    const shouldLevelUp = newStreak > 0 && newStreak % 5 === 0;
    if (shouldLevelUp) {
      setLevel(prev => {
        const nextLvl = prev + 1;
        triggerNotification(`NIVEAU SUPÉRIEUR ! Vous êtes au niveau ${nextLvl} 🎉`, 'level-up');
        return nextLvl;
      });
    }
  };

  // Start the Game
  const startGame = () => {
    if (!auth.currentUser) {
      triggerNotification("Veuillez d'abord vous connecter avec Google !", "error");
      return;
    }
    setGameMode('play');
    setIsPlaying(true);
    setIsPaused(false);
    setShowGameOver(false);
    setScore(0);
    setStreak(0);
    setLevel(1);
    setWordsAttempted(0);
    setWordsCorrect(0);
    setFloatingWords([]);
    setReviewWords([]);
    setTypedText('');
    setErrorsThisWord(0);
    
    // Clear passed words tracker
    passedWordsRef.current.clear();
    
    // Focus typing box after short delay to let DOM render
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);

    // Spawn multiple words at startup to populate the board immediately
    setTimeout(() => spawnWord(), 200);
    setTimeout(() => spawnWord(), 800);
    setTimeout(() => spawnWord(), 1400);
  };

  // End Game
  const endGame = () => {
    setIsPlaying(false);
    setShowGameOver(true);
    
    // Save to history
    const session = {
      date: new Date().toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      score: score,
      accuracy: wordsAttempted > 0 ? Math.round((wordsCorrect / wordsAttempted) * 100) : 100,
      mode: 'Pratique Unifiée'
    };

    const newHistory = [session, ...history].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('thewriter_history', JSON.stringify(newHistory));

    if (userId) {
      saveHistoryToFirestore(userId, session);
    }
  };

  // Accent clicking helper
  const handleAccentClick = (char) => {
    const text = typedText + char;
    setTypedText(text);
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <div className="app-container">
      {/* Dynamic Notifications */}
      {notification && (
        <div className={`game-notification ${notification.type}`}>
          {notification.type === 'missed' ? <AlertCircle size={20} /> : <Zap size={20} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header section */}
      <header className="app-header glass-panel">
        <div className="brand-section">
          <Trophy className="brand-icon" size={28} />
          <h1 className="brand-title">L'Écrivain</h1>
        </div>

        {/* User Auth Section */}
        <div className="auth-header-section">
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              {user.photoURL && (
                <img 
                  src={user.photoURL} 
                  alt={user.displayName} 
                  style={{ width: '30px', height: '30px', borderRadius: '50%', border: '2px solid var(--color-accent)' }} 
                />
              )}
              <span className="user-name" style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                {user.displayName}
              </span>
              <button 
                onClick={handleSignOut} 
                className="test-voice-btn" 
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                title="Se déconnecter"
              >
                <LogOut size={14} /> <span className="logout-text">Déconnexion</span>
              </button>
            </div>
          ) : (
            <button 
              onClick={handleSignInWithGoogle} 
              className="test-voice-btn" 
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', fontSize: '0.85rem', borderColor: 'rgba(255,255,255,0.15)' }}
            >
              <LogIn size={15} /> Connexion Google
            </button>
          )}
        </div>

        {isPlaying && (
          <div className="header-controls">
            
            <button 
              className="test-voice-btn"
              onClick={() => setIsPaused(prev => !prev)}
              title="Pause/Reprendre"
            >
              {isPaused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            
            <button 
              className="test-voice-btn"
              onClick={() => { if (confirm("Recommencer la partie ?")) startGame(); }}
              title="Recommencer"
            >
              <RefreshCw size={18} />
            </button>

            <button 
              className="test-voice-btn" 
              onClick={endGame}
              style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
            >
              Quitter
            </button>
          </div>
        )}
      </header>

      {/* Game Stats bar (when playing) */}
      {isPlaying && (
        <section className="stats-bar">
          <div className="stat-card glass-panel">
            <div className="stat-icon-wrapper score">
              <Trophy size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Score</span>
              <span className="stat-value">{score}</span>
            </div>
          </div>
          <div className="stat-card glass-panel">
            <div className="stat-icon-wrapper accuracy">
              <Target size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Précision</span>
              <span className="stat-value">
                {wordsAttempted > 0 ? Math.round((wordsCorrect / wordsAttempted) * 100) : 100}%
              </span>
            </div>
          </div>
          <div className="stat-card glass-panel">
            <div className="stat-icon-wrapper streak">
              <Flame size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Série active</span>
              <span className="stat-value">{streak}</span>
            </div>
          </div>
          <div className="stat-card glass-panel">
            <div className="stat-icon-wrapper level">
              <Zap size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Niveau</span>
              <span className="stat-value">{level}</span>
            </div>
          </div>
        </section>
      )}

      {/* Main workspace */}
      <main style={{ display: 'flex', flexGrow: 1, flexDirection: 'column' }}>
        
        {/* DASHBOARD (NOT PLAYING) */}
        {gameMode === 'dashboard' && !showGameOver && (
          <div className="dashboard-grid">
            
            {/* Left side: welcome and start */}
            <div className="welcome-panel glass-panel">
              <h2 className="welcome-title">Entraînez votre français par l'écriture</h2>
              <p className="welcome-desc">
                Un jeu de dactylographie rythmé pour perfectionner l'écriture des élisions complexes 
                (comme <em>l'amour</em>, <em>quelqu'un</em>, <em>je n'ai rien</em>) et maîtriser la conjugaison 
                des verbes irréguliers au passé, présent et futur.
              </p>
              
              <div style={{
                display: 'flex',
                gap: '1rem',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-glass)',
                marginTop: '0.25rem',
                width: 'fit-content'
              }}>
                <span>📊 <strong>Base de données :</strong></span>
                <span>{totalWordsCount} mots</span>
                <span>•</span>
                <span>{totalPhrasesCount} phrases</span>
              </div>
              
              <div style={{
                fontSize: '0.95rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.6',
                background: 'rgba(139, 92, 246, 0.03)',
                border: '1px solid rgba(139, 92, 246, 0.1)',
                padding: '1.25rem',
                borderRadius: '12px',
                margin: '1.5rem 0',
                width: '100%',
                textAlign: 'left'
              }}>
                <strong style={{ color: 'var(--color-accent)', display: 'block', marginBottom: '0.5rem' }}>💡 Règle du jeu unifié :</strong>
                <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>Les <strong>mots ordinaires</strong> (élisions) flottent avec un halo violet et peuvent être saisis <strong>à tout moment</strong>.</li>
                  <li>Les <strong>verbes conjugués</strong> doivent être saisis uniquement lorsqu'ils traversent leur zone correspondante : 🩷 <strong>Passé</strong> (gauche), 💚 <strong>Présent</strong> (milieu), ou 🩵 <strong>Futur</strong> (droite) !</li>
                </ul>
              </div>

              {user ? (
                <button className="start-btn" onClick={startGame}>
                  Démarrer la partie <ArrowRight size={18} />
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', width: '100%' }}>
                  <button 
                    className="start-btn" 
                    onClick={handleSignInWithGoogle}
                    style={{ background: 'linear-gradient(135deg, #ea4335 0%, #4285f4 100%)', boxShadow: '0 4px 15px rgba(234, 67, 53, 0.2)' }}
                  >
                    <LogIn size={18} /> Connectez-vous avec Google pour jouer
                  </button>
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 500 }}>
                    <AlertCircle size={14} /> La connexion est requise pour démarrer la partie.
                  </span>
                </div>
              )}
            </div>

            {/* Right side: settings & history */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Sound config */}
              <div className="config-panel glass-panel">
                <h3 className="config-title">
                  <Volume2 size={20} /> Configuration Vocale
                </h3>

                <div className="config-group">
                  <label className="config-label">Sélection de la voix</label>
                  <select 
                    className="config-select" 
                    value={ttsEngine} 
                    onChange={(e) => handleTtsEngineChange(e.target.value)}
                  >
                    <option value="cloud">🌟 Google Cloud (Haute qualité, Internet)</option>
                    <option value="openai">🔥 OpenAI Neural (Premium, Internet)</option>
                    <option value="local">🤖 Système Offline (Standard/Robotique)</option>
                  </select>
                </div>
                
                {ttsEngine === 'local' && (
                  <>
                    <div className="config-group">
                      <label className="config-label">Voix locale du système</label>
                      <select 
                         className="config-select" 
                         value={selectedVoice} 
                         onChange={(e) => handleVoiceChange(e.target.value)}
                      >
                        {voices.filter(v => v.lang.startsWith('fr')).length === 0 ? (
                          <option value="">Aucune voix locale française trouvée</option>
                        ) : null}
                        {voices.map(voice => (
                          <option key={voice.voiceURI} value={voice.voiceURI}>
                            {voice.name} ({voice.lang})
                          </option>
                        ))}
                      </select>
                    </div>
        
                    <div className="config-group">
                      <label className="config-label">
                        <span>Hauteur de voix (Pitch)</span>
                        <span>{speechPitch}x</span>
                      </label>
                      <input 
                        type="range" 
                        min="0.6" 
                        max="1.4" 
                        step="0.1" 
                        className="config-slider"
                        value={speechPitch}
                        onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                      />
                    </div>
                  </>
                )}

                <div className="config-group" style={{ marginTop: '0.25rem' }}>
                  <label className="config-label">
                    <span>Vitesse de lecture de la voix</span>
                    <span>{speechRate}x</span>
                  </label>
                  <input 
                    type="range" 
                    min="0.3" 
                    max="1.2" 
                    step="0.05" 
                    className="config-slider"
                    value={speechRate}
                    onChange={(e) => handleRateChange(parseFloat(e.target.value))}
                  />
                </div>

                <button className="test-voice-btn" onClick={handleTestVoice}>
                  <Volume2 size={16} /> Tester la voix
                </button>
              </div>

              {/* Game Play Speed config */}
              <div className="config-panel glass-panel">
                <h3 className="config-title">
                  <Settings size={18} /> Configuration du Jeu
                </h3>
                <div className="config-group">
                  <label className="config-label">
                    <span>Vitesse minimale des mots</span>
                    <span>{minWordSpeed}x</span>
                  </label>
                  <input 
                    type="range" 
                    min="0.3" 
                    max="2.0" 
                    step="0.1" 
                    className="config-slider"
                    value={minWordSpeed}
                    onChange={(e) => handleMinWordSpeedChange(parseFloat(e.target.value))}
                  />
                </div>
                <div className="config-group" style={{ marginTop: '0.75rem' }}>
                  <label className="config-label">
                    <span>Vitesse maximale des mots</span>
                    <span>{maxWordSpeed}x</span>
                  </label>
                  <input 
                    type="range" 
                    min="0.3" 
                    max="2.0" 
                    step="0.1" 
                    className="config-slider"
                    value={maxWordSpeed}
                    onChange={(e) => handleMaxWordSpeedChange(parseFloat(e.target.value))}
                  />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem' }}>
                  Ajustez les vitesses pour définir la plage de vitesse aléatoire de chaque mot.
                </span>
              </div>

              {/* History Panel */}
              <div className="config-panel glass-panel" style={{ flexGrow: 1 }}>
                <h3 className="config-title">
                  <Calendar size={18} /> Historique des Parties
                </h3>
                {history.length === 0 ? (
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    Aucune partie enregistrée pour le moment.
                  </p>
                ) : (
                  <div className="history-list">
                    {history.map((item, idx) => (
                      <div key={idx} className="history-item">
                        <div>
                          <div style={{ fontWeight: 600 }}>{item.mode}</div>
                          <div className="history-date">{item.date}</div>
                        </div>
                        <div className="history-stats">
                          <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{item.score} pts</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.accuracy}% acc</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MODE 1: MARATHON D'ÉLISONS */}
        {isPlaying && gameMode === 'elision' && (
          <div className="game-layout">
            <div className="marathon-arena">
              
              {/* Particle overlay */}
              {particles.map(p => (
                <div 
                  key={p.id} 
                  className="particle"
                  style={{
                    left: p.x,
                    top: p.y,
                    width: p.size,
                    height: p.size,
                    backgroundColor: p.color,
                    '--dx': p.dx,
                    '--dy': p.dy
                  }}
                />
              ))}

              {isPaused && (
                <div className="modal-overlay" style={{ position: 'absolute', zIndex: 10 }}>
                  <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Partie en Pause</h3>
                    <button className="start-btn" onClick={() => setIsPaused(false)}>
                      Reprendre
                    </button>
                  </div>
                </div>
              )}

              {/* Arena window */}
              <div className="floating-space glass-panel">
                {floatingWords.length === 0 && (
                  <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    En attente de mots...
                  </div>
                )}
                {floatingWords.map(word => (
                  <div 
                    key={word.id}
                    className="floating-word"
                    style={{
                      left: `${word.x}%`,
                      top: `${word.y}%`
                    }}
                  >
                    <span>{word.text}</span>
                    <span className="translation-hint">{word.translation}</span>
                  </div>
                ))}
              </div>

              {/* Typing inputs & controls */}
              <div className="typing-bar">
                <div className="input-container">
                  <input
                    ref={inputRef}
                    type="text"
                    className={`typing-input ${inputState === 'error' ? 'error' : ''} ${inputState === 'correct' ? 'correct' : ''}`}
                    placeholder="Tapez le mot français ici..."
                    value={typedText}
                    onChange={handleInputChange}
                    disabled={isPaused}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
              </div>

              {/* Character palette helper */}
              <div className="character-guide">
                {['é', 'è', 'à', 'ù', 'ç', 'œ', 'æ', 'â', 'ê', 'î', 'ô', 'û', "'"].map(c => (
                  <button 
                    key={c}
                    className="accent-helper-btn"
                    onClick={() => handleAccentClick(c)}
                  >
                    {c}
                  </button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <Info size={14} /> Astuce: Vous pouvez seulement valider le verbe lorsqu'il flotte dans sa zone de conjugaison.
                </div>
              </div>
     
            </div>
          </div>
        )}

        {/* UNIFIED GAME ARENA */}
        {isPlaying && (
          <div className="game-layout">
            <div className="tense-arena" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '520px', position: 'relative', width: '100%' }}>
              
              {/* Particle overlay */}
              {particles.map(p => (
                <div 
                  key={p.id} 
                  className="particle"
                  style={{
                    left: p.x,
                    top: p.y,
                    width: p.size,
                    height: p.size,
                    backgroundColor: p.color,
                    '--dx': p.dx,
                    '--dy': p.dy
                  }}
                />
              ))}

              {isPaused && (
                <div className="modal-overlay" style={{ position: 'absolute', zIndex: 10 }}>
                  <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Partie en Pause</h3>
                    <button className="start-btn" onClick={() => setIsPaused(false)}>
                      Reprendre
                    </button>
                  </div>
                </div>
              )}

              {/* Background columns partitioning the board space */}
              <div className="columns-background-grid" style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '1.25rem',
                flexGrow: 1,
                minHeight: '400px',
                position: 'relative',
                borderRadius: '16px',
                overflow: 'hidden'
              }}>
                <div className="column-bg past" style={{ background: 'rgba(236, 72, 153, 0.04)', border: '1px dashed rgba(236, 72, 153, 0.12)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '1.25rem' }}>
                  <span style={{ color: 'var(--color-past)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.3rem', letterSpacing: '0.5px' }}>PASSÉ (Past)</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Zone de gauche (0% - 33%)</span>
                </div>
                <div className="column-bg present" style={{ background: 'rgba(16, 185, 129, 0.04)', border: '1px dashed rgba(16, 185, 129, 0.12)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '1.25rem' }}>
                  <span style={{ color: 'var(--color-present)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.3rem', letterSpacing: '0.5px' }}>PRÉSENT (Present)</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Zone du milieu (33% - 66%)</span>
                </div>
                <div className="column-bg future" style={{ background: 'rgba(6, 182, 212, 0.04)', border: '1px dashed rgba(6, 182, 212, 0.12)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '1.25rem' }}>
                  <span style={{ color: 'var(--color-future)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.3rem', letterSpacing: '0.5px' }}>FUTUR (Future)</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Zone de droite (66% - 100%)</span>
                </div>
                
                {/* Floating words overlay container */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
                  {floatingWords.map(word => {
                    // Check which column the word is in based on its X position
                    const currentCol = word.x < 33.3 ? 'past' : (word.x < 66.6 ? 'present' : 'future');
                    const isMatchable = currentCol === word.tense;
                    
                    return (
                      <div 
                        key={word.id}
                        className={`floating-word ${isMatchable ? word.tense : ''}`}
                        style={{
                          position: 'absolute',
                          left: `${word.x}%`,
                          top: `${word.y}%`,
                          pointerEvents: 'auto',
                          opacity: isMatchable ? 1 : 0.6,
                          borderColor: isMatchable ? 'currentColor' : 'rgba(255,255,255,0.06)',
                          boxShadow: isMatchable ? `0 0 15px currentColor` : 'none',
                          transform: isMatchable ? 'scale(1.08)' : 'scale(0.95)',
                          transition: 'opacity 0.2s, border-color 0.2s, transform 0.2s, box-shadow 0.2s'
                        }}
                      >
                         <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                           {isMatchable && <span style={{ fontSize: '0.85rem' }}>🎯</span>}
                           <span>{word.text}</span>
                         </div>
                         <span className="translation-hint">{word.translation}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
     
              {/* Single typing input box at the bottom of the arena */}
              <div className="typing-bar" style={{ marginTop: '1.5rem' }}>
                <div className="input-container" style={{ width: '100%' }}>
                  <input
                    ref={inputRef}
                    type="text"
                    className={`typing-input ${inputState === 'error' ? 'error' : ''} ${inputState === 'correct' ? 'correct' : ''}`}
                    placeholder="Tapez le verbe quand il flotte dans sa zone correspondante !"
                    value={typedText}
                    onChange={handleInputChange}
                    disabled={isPaused}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
              </div>
     
              {/* Accent helper palette */}
              <div className="character-guide" style={{ marginTop: '0.75rem' }}>
                {['é', 'è', 'à', 'ù', 'ç', 'œ', 'æ', 'â', 'ê', 'î', 'ô', 'û', "'"].map(c => (
                  <button 
                    key={c}
                    className="accent-helper-btn"
                    onClick={() => handleAccentClick(c)}
                  >
                    {c}
                  </button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <Info size={14} /> Astuce: Vous pouvez seulement valider le verbe lorsqu'il flotte dans sa zone de conjugaison.
                </div>
              </div>
     
            </div>
          </div>
        )}

        {/* GAME OVER MODAL */}
        {showGameOver && (
          <div className="modal-overlay">
            <div className="game-over-modal glass-panel">
              <h2 className="modal-title">Entraînement Terminé !</h2>
              
              <div className="modal-stats">
                <div className="modal-stat-box">
                  <span className="modal-stat-label">Score Final</span>
                  <span className="modal-stat-value" style={{ color: 'var(--color-accent)' }}>{score}</span>
                </div>
                <div className="modal-stat-box">
                  <span className="modal-stat-label">Précision</span>
                  <span className="modal-stat-value" style={{ color: 'var(--color-present)' }}>
                    {wordsAttempted > 0 ? Math.round((wordsCorrect / wordsAttempted) * 100) : 100}%
                  </span>
                </div>
              </div>

              {/* Missed words review */}
              {reviewWords.length > 0 && (
                <div className="modal-word-review">
                  <div className="modal-word-review-title">Mots à réviser :</div>
                  {reviewWords.map((word, idx) => (
                    <div key={idx} className="review-item">
                      <span className="spelling">{word.text}</span>
                      <span className="translation">{word.translation} {word.tense ? `(${word.tense})` : ''}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button 
                  className="modal-btn primary"
                  onClick={() => startGame(gameMode)}
                >
                  Rejouer
                </button>
                <button 
                  className="modal-btn secondary"
                  onClick={() => {
                    setGameMode('dashboard');
                    setShowGameOver(false);
                  }}
                >
                  Menu principal
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
