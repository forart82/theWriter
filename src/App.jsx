import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Trophy, 
  Target, 
  Flame, 
  Zap, 
  Settings, 
  Volume2, 
  AlertCircle,
  ArrowRight,
  Info,
  Calendar,
  LogOut,
  X
} from 'lucide-react';
import { getWordsForLevel, totalWordsCount, totalPhrasesCount } from './words';
import './App.css';
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

// Format seconds into MM:SS
const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// Normalize text to simplify special French characters for typing keyboards
const normalizeText = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ç/g, 'c');
};

// Web Audio API Synthesizer Sound Generator
const playSynthSound = (type) => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    if (type === 'match') {
      // Laser sweep up
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'error') {
      // Retro buzz
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, ctx.currentTime);
      osc.frequency.setValueAtTime(80, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === 'wave-clear') {
      // Cyber chime arpeggio
      const notes = [293.66, 349.23, 440.00, 587.33, 698.46, 880.00, 1174.66]; // D minor arpeggio
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.07);
        gain.gain.setValueAtTime(0.06, ctx.currentTime + i * 0.07);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.07 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.07);
        osc.stop(ctx.currentTime + i * 0.07 + 0.3);
      });
    }
  } catch (err) {
    console.warn("Web Audio synthesis failed", err);
  }
};

export default function App() {
  // 1. STATE INITIALIZATION (Using lazy initializers)
  const [user, setUser] = useState(undefined); 
  const [userId, setUserId] = useState('');

  const [gameMode, setGameMode] = useState('dashboard'); // 'dashboard', 'play'
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isWaveTransition, setIsWaveTransition] = useState(false);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [level, setLevel] = useState(1); // Wave number
  const [wordsAttempted, setWordsAttempted] = useState(0);
  const [wordsCorrect, setWordsCorrect] = useState(0);

  // HP Shield and Cyber Flasher
  const [shield, setShield] = useState(100);
  const [isFlashingError, setIsFlashingError] = useState(false);

  const [badges, setBadges] = useState([]);
  const [particles, setParticles] = useState([]);
  const [typedText, setTypedText] = useState('');
  const [inputState, setInputState] = useState('normal'); // 'normal', 'error', 'correct'
  const [lastCheckedInput, setLastCheckedInput] = useState('');
  const [errorsThisWord, setErrorsThisWord] = useState(0);
  const [reviewWords, setReviewWords] = useState([]);
  
  const [history, setHistory] = useState(() => {
    const savedHistory = localStorage.getItem('thewriter_history');
    if (savedHistory) {
      try {
        return JSON.parse(savedHistory);
      } catch (e) {
        console.error('Failed to parse game history', e);
      }
    }
    return [];
  });

  // Persist completed items to guarantee no repeats
  const [completedTexts, setCompletedTexts] = useState(() => {
    const saved = localStorage.getItem('thewriter_completed_texts');
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse completed texts', e);
      }
    }
    return new Set();
  });

  const [timer, setTimer] = useState(180);
  const maxTime = 180;

  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  
  const [speechRate, setSpeechRate] = useState(() => {
    const savedRate = localStorage.getItem('thewriter_speech_rate');
    return savedRate ? parseFloat(savedRate) : 0.7;
  });
  
  const [speechPitch, setSpeechPitch] = useState(() => {
    const savedPitch = localStorage.getItem('thewriter_speech_pitch');
    return savedPitch ? parseFloat(savedPitch) : 1.0;
  });
  
  const [ttsEngine, setTtsEngine] = useState(() => {
    const savedTtsEngine = localStorage.getItem('thewriter_tts_engine');
    return savedTtsEngine || 'cloud';
  });
  
  const [notification, setNotification] = useState(null);

  // 2. REFS
  const inputRef = useRef(null);
  const notificationTimeoutRef = useRef(null);

  // Calculate score multiplier based on streak
  const getMultiplier = useCallback(() => {
    if (streak < 5) return 1.0;
    if (streak < 10) return 1.5;
    if (streak < 15) return 2.0;
    return 3.0;
  }, [streak]);

  // Calculate system typing rank
  const getRating = useCallback(() => {
    const accuracy = wordsAttempted > 0 ? (wordsCorrect / wordsAttempted) * 100 : 100;
    if (accuracy >= 95 && level >= 3) return { grade: 'S-CLASS', desc: 'CYBERGOD DESTRUCT', color: '#ffcc00' };
    if (accuracy >= 85) return { grade: 'A-CLASS', desc: 'ELITE OPERATIVE', color: '#39ff14' };
    if (accuracy >= 70) return { grade: 'B-CLASS', desc: 'NET RUNNER', color: '#00f0ff' };
    return { grade: 'C-CLASS', desc: 'RECRUIT DESTRUCT', color: '#ff0055' };
  }, [wordsAttempted, wordsCorrect, level]);

  // 3. HELPER FUNCTIONS

  // Notification trigger
  const triggerNotification = useCallback((message, type) => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setNotification({ message, type });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 3500);
  }, []);

  // TTS utilities
  const speakLocalWord = useCallback((text, rate) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      const voice = voices.find(v => v.voiceURI === selectedVoice);
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.pitch = speechPitch;
      window.speechSynthesis.speak(utterance);
    }
  }, [voices, selectedVoice, speechPitch]);

  const speakGoogleWord = useCallback((text, rate) => {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=fr&client=tw-ob&q=${encodeURIComponent(text)}`;
    const audio = new Audio(url);
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.playbackRate = rate;
    audio.play().catch(err => {
      console.warn("Google Cloud TTS failed, falling back to local Speech engine", err);
      speakLocalWord(text, rate);
    });
  }, [speakLocalWord]);

  const speakWord = useCallback((text, slow = false) => {
    const rate = slow ? speechRate * 0.8 : speechRate;
    
    if (ttsEngine === 'openai' && window.puter) {
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
  }, [speechRate, ttsEngine, speakGoogleWord, speakLocalWord]);

  const handleTestVoice = () => {
    speakWord("Bonjour ! Bienvenue dans l'application l'Écrivain.");
  };

  // Auth operations
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

  // Firestore DB operations
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
      }
    } catch (e) {
      console.warn("Could not load settings from Firestore, using local defaults", e);
    }
  };

  const saveSettingsToFirestore = async (uid, settingsUpdate) => {
    try {
      const docRef = doc(db, 'users', uid, 'config', 'settings');
      await setDoc(docRef, settingsUpdate, { merge: true });
    } catch (e) {
      console.warn("Could not save settings to Firestore", e);
    }
  };

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

  // Settings syncing handlers
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

  // Particle Explosions
  const createExplosion = (x, y, colorClass) => {
    let particleColor = '#8b5cf6'; // Violet
    if (colorClass === 'past') particleColor = '#ec4899'; // Pink
    else if (colorClass === 'present') particleColor = '#10b981'; // Green
    else if (colorClass === 'future') particleColor = '#06b6d4'; // Cyan

    const newParticles = Array.from({ length: 16 }).map((_, i) => {
      const angle = (i / 16) * Math.PI * 2 + (Math.random() * 0.4);
      const speed = 3 + Math.random() * 8;
      return {
        id: Math.random(),
        x: `${x}px`,
        y: `${y}px`,
        dx: `${Math.cos(angle) * speed * 25}px`,
        dy: `${Math.sin(angle) * speed * 25}px`,
        size: `${4 + Math.random() * 8}px`,
        color: particleColor
      };
    });

    setParticles(prev => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newParticles.some(np => np.id === p.id)));
    }, 850);
  };

  // Non-repeating selector: Select badges for Level
  const selectBadgesForLevel = useCallback((lvl) => {
    const pool = getWordsForLevel(lvl);
    if (!pool || pool.length === 0) return [];
    
    const count = Math.min(pool.length, 40 + lvl * 10);
    
    // Filter out already completed items
    let available = pool.filter(w => !completedTexts.has(w.text));
    
    // Reset completed items in this pool if not enough left
    if (available.length < count) {
      setCompletedTexts(prev => {
        const updated = new Set(prev);
        pool.forEach(w => updated.delete(w.text));
        localStorage.setItem('thewriter_completed_texts', JSON.stringify(Array.from(updated)));
        return updated;
      });
      available = pool;
    }
    
    const shuffled = shuffleArray(available);
    
    return shuffled.slice(0, count).map((w, index) => ({
      id: index,
      text: w.text,
      translation: w.translation,
      tense: w.tense || 'any',
      isDestroyed: false
    }));
  }, [completedTexts]);

  // Game lifecycle controls
  const endGame = useCallback(() => {
    setIsPlaying(false);
    setShowGameOver(true);

    const accuracy = wordsAttempted > 0 ? Math.round((wordsCorrect / wordsAttempted) * 100) : 100;
    const unreached = badges.filter(b => !b.isDestroyed);
    setReviewWords(unreached);

    const session = {
      date: new Date().toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      score: score,
      accuracy: accuracy,
      mode: `Vague ${level}`
    };

    setHistory(prev => {
      const updated = [session, ...prev].slice(0, 10);
      localStorage.setItem('thewriter_history', JSON.stringify(updated));
      return updated;
    });

    if (userId) {
      saveHistoryToFirestore(userId, session);
    }
  }, [badges, score, level, wordsAttempted, wordsCorrect, userId]);

  const handleWaveCleared = useCallback(() => {
    setIsWaveTransition(true);
    triggerNotification(`Vague ${level} réussie ! 🎉 Vague suivante en préparation...`, 'success');
    
    // Sound FX: wave cleared chime
    playSynthSound('wave-clear');
    speakWord("Excellent ! Vague terminée.");
    
    setTimeout(() => {
      setLevel(prev => {
        const nextLevel = prev + 1;
        const newBadges = selectBadgesForLevel(nextLevel);
        setBadges(newBadges);
        setTimer(180);
        setShield(Math.min(100, shield + 25)); // Repair system shield slightly on wave clear
        setIsWaveTransition(false);
        return nextLevel;
      });
    }, 2000);
  }, [level, triggerNotification, speakWord, selectBadgesForLevel, shield]);

  const startGame = () => {
    if (!auth.currentUser) {
      triggerNotification("Veuillez d'abord vous connecter !", "error");
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
    setReviewWords([]);
    setTypedText('');
    setErrorsThisWord(0);
    setShield(100);

    const initialBadges = selectBadgesForLevel(1);
    setBadges(initialBadges);
    setTimer(180);

    // Focus input field
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 150);
  };

  const handleBadgeSolved = (badge) => {
    // Sound FX: laser pop match
    playSynthSound('match');
    speakWord(badge.text);

    // Get badge position on screen
    const element = document.getElementById(`badge-${badge.id}`);
    if (element) {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      createExplosion(x, y, badge.tense);
    }

    // Add to completed set
    setCompletedTexts(prev => {
      const updated = new Set(prev);
      updated.add(badge.text);
      localStorage.setItem('thewriter_completed_texts', JSON.stringify(Array.from(updated)));
      return updated;
    });

    // Mark badge destroyed
    setBadges(prev => prev.map(b => b.id === badge.id ? { ...b, isDestroyed: true } : b));

    // Stats updates
    setWordsCorrect(prev => prev + 1);
    setWordsAttempted(prev => prev + 1);

    const newStreak = streak + 1;
    setStreak(newStreak);

    // Shield recovery on solved word
    setShield(prev => Math.min(100, prev + 3));

    // Score calculations (with multiplier)
    const baseVal = Math.max(20, 100 - (errorsThisWord * 15));
    const scoreGain = Math.round(baseVal * getMultiplier());
    setScore(prev => prev + scoreGain);
    setErrorsThisWord(0);

    // Remove badge completely from state list after pop animation delay
    setTimeout(() => {
      setBadges(prev => prev.filter(b => b.id !== badge.id));
    }, 300);
  };

  const handleBadgeClick = (badge) => {
    speakWord(badge.text);
    triggerNotification(`"${badge.text}" = "${badge.translation}"`, 'success');
  };

  // Typing Input handler
  const handleInputChange = (e) => {
    const text = e.target.value;
    setTypedText(text);

    if (text === '') {
      setInputState('normal');
      return;
    }

    // Prefix validation against active badges
    const isPrefixOfAny = badges.some(b => 
      !b.isDestroyed && normalizeText(b.text).startsWith(normalizeText(text))
    );

    if (!isPrefixOfAny) {
      setInputState('error');
      if (text.length > lastCheckedInput.length) {
        setErrorsThisWord(prev => prev + 1);
        
        // Error audio buzz
        playSynthSound('error');

        // Screen border error flasher
        setIsFlashingError(true);
        setTimeout(() => setIsFlashingError(false), 200);

        // HP Shield damage on typing error
        setShield(prev => {
          const nextShield = Math.max(0, prev - 5);
          if (nextShield <= 0) {
            // Trigger game over next render loop
            setTimeout(() => {
              endGame();
            }, 0);
          }
          return nextShield;
        });
      }
    } else {
      setInputState('normal');
    }

    setLastCheckedInput(text);

    // Match validation
    const matchingBadge = badges.find(b => 
      !b.isDestroyed && normalizeText(b.text) === normalizeText(text.trim())
    );

    if (matchingBadge) {
      handleBadgeSolved(matchingBadge);
      setTypedText('');
      setInputState('correct');
      setTimeout(() => setInputState('normal'), 200);
    }
  };

  // Helper characters
  const handleAccentClick = (char) => {
    const text = typedText + char;
    setTypedText(text);
    if (inputRef.current) inputRef.current.focus();
  };

  // 4. EFFECTS

  // Auth and voice initializer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setUserId(currentUser.uid);
        loadSettingsFromFirestore(currentUser.uid);
        loadHistoryFromFirestore(currentUser.uid);
      } else {
        setUser(null);
        setUserId('');
      }
    });

    if ('speechSynthesis' in window) {
      const getSpeechVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        setVoices(availableVoices);
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

  // Timer interval loop
  useEffect(() => {
    let interval;
    if (isPlaying && !isPaused && !showGameOver && !isWaveTransition) {
      interval = setInterval(() => {
        setTimer(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            endGame();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isPaused, showGameOver, isWaveTransition, endGame]);

  // Check if wave completed (defrred by setTimeout to avoid synchronous setState inside render warnings)
  useEffect(() => {
    if (isPlaying && badges.length > 0 && badges.every(b => b.isDestroyed) && !isWaveTransition) {
      const timerId = setTimeout(() => {
        handleWaveCleared();
      }, 0);
      return () => clearTimeout(timerId);
    }
  }, [badges, isPlaying, isWaveTransition, handleWaveCleared]);

  // 5. RENDER BLOCKS

  // A. LOADING STATE
  if (user === undefined) {
    return (
      <div className="login-page">
        <div className="loading-spinner-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">Chargement de l'Écrivain...</p>
        </div>
      </div>
    );
  }

  // B. UNAUTHENTICATED LOGIN PAGE (FRAME AND BUTTON ONLY)
  if (user === null) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">✍️</div>
          <h1 className="login-title">L'Écrivain</h1>
          <p className="login-subtitle">
            Détruisez les badges de conjugaison et d'élisions en écrivant correctement leur orthographe française.
          </p>
          <button className="login-btn" onClick={handleSignInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '8px' }}>
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

  // C. AUTHENTICATED WORKSPACE
  const currentMultiplier = getMultiplier();

  return (
    <div className="app-container">
      {/* Top level red screen error flash overlay */}
      {isFlashingError && <div className="screen-red-flasher" />}

      {/* Top level particle overlay */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
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
      </div>

      {/* Notifications */}
      {notification && (
        <div className={`game-notification ${notification.type}`}>
          <AlertCircle size={20} />
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="app-header glass-panel">
        <div className="brand-section">
          <Trophy className="brand-icon" size={28} />
          <h1 className="brand-title">L'Écrivain</h1>
        </div>

        <div className="auth-header-section">
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
              onClick={() => setShowSettings(true)} 
              className="test-voice-btn"
              title="Paramètres vocaux"
              style={{ padding: '0.35rem 0.5rem' }}
            >
              <Settings size={16} />
            </button>
            <button 
              onClick={handleSignOut} 
              className="test-voice-btn" 
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              title="Se déconnecter"
            >
              <LogOut size={14} /> <span className="logout-text">Déconnexion</span>
            </button>
          </div>
        </div>

        {isPlaying && (
          <div className="header-controls">
            <button 
              className="test-voice-btn" 
              onClick={endGame}
              style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
            >
              Abandonner
            </button>
          </div>
        )}
      </header>

      {/* Stats bar HUD */}
      {isPlaying && (
        <section className="stats-bar">
          <div className="stat-card glass-panel">
            <div className="stat-icon-wrapper score">
              <Trophy size={20} />
            </div>
            <div className="stat-info" style={{ width: '100%' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="stat-label">Série / Multiplier</span>
                {currentMultiplier > 1.0 && (
                  <span style={{ 
                    fontSize: '0.65rem', 
                    background: 'var(--color-warning)', 
                    color: '#000', 
                    padding: '0.05rem 0.25rem', 
                    borderRadius: '2px', 
                    fontWeight: 900 
                  }}>
                    {currentMultiplier}x 🔥
                  </span>
                )}
              </div>
              <span className="stat-value" style={{ color: currentMultiplier > 1.0 ? 'var(--color-warning)' : 'inherit' }}>
                {streak}
              </span>
            </div>
          </div>
          <div className="stat-card glass-panel">
            <div className="stat-icon-wrapper level">
              <Zap size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-label">Vague / HP Shield</span>
              <span className="stat-value" style={{ fontSize: '1.1rem' }}>
                VAGUE {level}
              </span>
              <div className="shield-bar-bg">
                <div 
                  className={`shield-bar-fill ${shield <= 30 ? 'low' : ''}`} 
                  style={{ width: `${shield}%` }} 
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Content Area */}
      <main style={{ display: 'flex', flexGrow: 1, flexDirection: 'column' }}>
        
        {/* A. DASHBOARD */}
        {gameMode === 'dashboard' && !showGameOver && (
          <div className="dashboard-grid">
            
            {/* Welcome info */}
            <div className="welcome-panel glass-panel">
              <h2 className="welcome-title">Système D'Écriture Cyber</h2>
              <p className="welcome-desc">
                Des dizaines de badges de données flottent sur la grille de terminal. Saisissez leur texte français pour désintégrer la puce de données. Restaurez votre bouclier système, accumulez les multiplicateurs de série et survivez aux vagues !
              </p>
              
              <div style={{
                display: 'flex',
                gap: '1rem',
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                background: 'rgba(0, 240, 255, 0.03)',
                padding: '0.6rem 1rem',
                borderRadius: '4px',
                border: '1px solid rgba(0, 240, 255, 0.1)'
              }}>
                <span>📊 <strong>Base Active :</strong></span>
                <span>{totalWordsCount} mots</span>
                <span>•</span>
                <span>{totalPhrasesCount} phrases</span>
              </div>
              
              <div style={{
                fontSize: '0.95rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.6',
                background: 'rgba(0, 240, 255, 0.01)',
                border: '1px solid rgba(0, 240, 255, 0.08)',
                padding: '1.25rem',
                borderRadius: '4px',
                margin: '1rem 0',
                width: '100%'
              }}>
                <strong style={{ color: 'var(--text-cyber)', display: 'block', marginBottom: '0.5rem', fontFamily: 'var(--font-display)' }}>💡 HUD DE CIBLAGE :</strong>
                <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li><span style={{ color: 'var(--color-elision)', fontWeight: 'bold' }}>💜 Élisions :</span> Mots avec apostrophes (e.g. <em>l'amour</em>, <em>qu'il</em>)</li>
                  <li><span style={{ color: 'var(--color-past)', fontWeight: 'bold' }}>🩷 Passé :</span> Verbes au passé (e.g. <em>j'ai chanté</em>)</li>
                  <li><span style={{ color: 'var(--color-present)', fontWeight: 'bold' }}>💚 Présent :</span> Verbes au présent (e.g. <em>je chante</em>)</li>
                  <li><span style={{ color: 'var(--color-future)', fontWeight: 'bold' }}>🩵 Futur :</span> Verbes au futur (e.g. <em>je chanterai</em>)</li>
                </ul>
              </div>

              <button className="start-btn" onClick={startGame}>
                Initialiser le ciblage <ArrowRight size={18} />
              </button>
            </div>

            {/* History logs */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div className="config-panel glass-panel" style={{ flexGrow: 1 }}>
                <h3 className="config-title">
                  <Calendar size={18} /> Sessions Précédentes
                </h3>
                {history.length === 0 ? (
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    Aucun log de session enregistré.
                  </p>
                ) : (
                  <div className="history-list">
                    {history.map((item, idx) => (
                      <div key={idx} className="history-item">
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-cyber)' }}>{item.mode}</div>
                          <div className="history-date">{item.date}</div>
                        </div>
                        <div className="history-stats">
                          <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>{item.score} pts</span>
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

        {/* B. ACTIVE GAMEPLAY */}
        {isPlaying && (
          <div className="game-layout">
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              {/* Timer & Count Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1.5rem' }}>
                <div className="timer-container" style={{ flexGrow: 1 }}>
                  <div className="timer-bar-bg">
                    <div 
                      className={`timer-bar-fill ${timer <= 20 ? 'danger' : timer <= 60 ? 'warning' : ''}`}
                      style={{ width: `${(timer / maxTime) * 100}%` }}
                    />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--text-cyber)', minWidth: '70px', textAlign: 'right', textShadow: '0 0 5px rgba(0, 240, 255, 0.4)' }}>
                    ⏱️ {formatTime(timer)}
                  </span>
                </div>
                
                <div className="glass-panel" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', fontWeight: 600, display: 'flex', gap: '0.5rem', alignItems: 'center', borderColor: 'rgba(0, 240, 255, 0.3)' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', letterSpacing: '1px' }}>CIBLES RESTANTES :</span>
                  <span style={{ color: 'var(--text-cyber)', fontFamily: 'var(--font-mono)', fontSize: '1.15rem', textShadow: '0 0 5px rgba(0, 240, 255, 0.5)' }}>
                    {badges.filter(b => !b.isDestroyed).length}
                  </span>
                </div>
              </div>

              {/* Badges Container Grid */}
              <div className="badges-container">
                <div className="badges-scrollable">
                  <div className="badges-grid">
                    {badges.map(badge => {
                      const isHighlighted = typedText && normalizeText(badge.text).startsWith(normalizeText(typedText.trim()));
                      let cardTypeClass = 'badge-elision';
                      let tenseLabel = 'Élision';
                      
                      if (badge.tense === 'past') {
                        cardTypeClass = 'badge-past';
                        tenseLabel = 'Passé';
                      } else if (badge.tense === 'present') {
                        cardTypeClass = 'badge-present';
                        tenseLabel = 'Présent';
                      } else if (badge.tense === 'future') {
                        cardTypeClass = 'badge-future';
                        tenseLabel = 'Futur';
                      }

                      return (
                        <div 
                          key={badge.id}
                          id={`badge-${badge.id}`}
                          onClick={() => handleBadgeClick(badge)}
                          className={`badge-item ${cardTypeClass} ${isHighlighted ? 'highlighted' : ''} ${badge.isDestroyed ? 'destroyed' : ''}`}
                        >
                          <span className="badge-tag">{tenseLabel}</span>
                          <span className="badge-text">{badge.text}</span>
                          <span className="badge-translation">{badge.translation}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Typing inputs */}
              <div className="typing-bar">
                <div className="input-container">
                  <input
                    ref={inputRef}
                    type="text"
                    className={`typing-input ${inputState === 'error' ? 'error' : ''} ${inputState === 'correct' ? 'correct' : ''}`}
                    placeholder="Saisissez un mot ou une phrase cible..."
                    value={typedText}
                    onChange={handleInputChange}
                    disabled={isPaused || isWaveTransition}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                </div>
              </div>

              {/* Accent Helpers */}
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
                  <Info size={14} /> Astuce: Les frappes manquées endommagent votre HP Shield.
                </div>
              </div>

            </div>
          </div>
        )}

        {/* C. GAME OVER MODAL */}
        {showGameOver && (
          <div className="modal-overlay">
            <div className={`game-over-modal glass-panel ${shield > 0 && timer > 0 ? 'victory' : ''}`}>
              <h2 className="modal-title">
                {shield > 0 && timer > 0 ? 'PURGE COMPLÉTÉE AVEC SUCCÈS' : 'DÉFAILLANCE CRITIQUE DU SYSTÈME'}
              </h2>
              <div className="modal-log-sub">
                {shield > 0 && timer > 0 ? '// STATUS: RUN_COMPLETED' : timer === 0 ? '// STATUS: TIME_EXPIRED' : '// STATUS: SHIELD_DEPLETED'}
              </div>
              
              <div className="modal-stats">
                <div className="modal-stat-box">
                  <span className="modal-stat-label">Score Final</span>
                  <span className="modal-stat-value" style={{ color: 'var(--color-warning)', textShadow: '0 0 8px rgba(255, 157, 0, 0.4)' }}>{score} pts</span>
                  <span className="modal-stat-desc">Données accumulées</span>
                </div>
                <div className="modal-stat-box">
                  <span className="modal-stat-label">Vague Atteinte</span>
                  <span className="modal-stat-value" style={{ color: 'var(--color-past)', textShadow: '0 0 8px rgba(255, 0, 85, 0.4)' }}>VAGUE {level}</span>
                  <span className="modal-stat-desc">Dernier palier d'attaque</span>
                </div>
                <div className="modal-stat-box">
                  <span className="modal-stat-label">Cibles Détruites</span>
                  <span className="modal-stat-value" style={{ color: 'var(--color-future)', textShadow: '0 0 8px rgba(0, 240, 255, 0.4)' }}>{wordsCorrect} / {wordsAttempted}</span>
                  <span className="modal-stat-desc">Purge de badges</span>
                </div>
                <div className="modal-stat-box">
                  <span className="modal-stat-label">Précision</span>
                  <span className="modal-stat-value" style={{ color: 'var(--color-present)', textShadow: '0 0 8px rgba(57, 255, 20, 0.4)' }}>
                    {wordsAttempted > 0 ? Math.round((wordsCorrect / wordsAttempted) * 100) : 100}%
                  </span>
                  <span className="modal-stat-desc">Exactitude de frappe</span>
                </div>
              </div>

              {/* Rating Card Display */}
              {(() => {
                const rating = getRating();
                return (
                  <div className="rating-badge-container" style={{ borderColor: rating.color }}>
                    <span className="rating-badge-label">Rang Opérationnel :</span>
                    <span className="rating-badge-desc" style={{ color: rating.color }}>{rating.desc}</span>
                    <span className="rating-badge-tag" style={{ color: rating.color }}>{rating.grade}</span>
                  </div>
                );
              })()}

              {/* Review words with audio replay button */}
              {reviewWords.length > 0 && (
                <div className="modal-word-review">
                  <div className="modal-word-review-title">Fichiers non purgés (Cliquez pour prononcer) :</div>
                  {reviewWords.slice(0, 30).map((badge, idx) => (
                    <div key={idx} className="review-item">
                      <span className="spelling" style={{ color: 'var(--color-past)' }}>{badge.text}</span>
                      <span className="translation">{badge.translation} {badge.tense !== 'any' ? `(${badge.tense})` : ''}</span>
                      <button 
                        className="review-play-btn" 
                        onClick={() => speakWord(badge.text)}
                        title="Réécouter la cible"
                      >
                        🔊
                      </button>
                    </div>
                  ))}
                  {reviewWords.length > 30 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      ... et {reviewWords.length - 30} autres cibles de données.
                    </div>
                  )}
                </div>
              )}

              <div className="modal-actions">
                <button className="modal-btn primary" onClick={startGame}>
                  Initialiser nouveau run
                </button>
                <button 
                  className="modal-btn secondary" 
                  onClick={() => {
                    setGameMode('dashboard');
                    setShowGameOver(false);
                  }}
                >
                  Menu Terminal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* D. SETTINGS MODAL */}
        {showSettings && (
          <div className="modal-overlay">
            <div className="settings-modal glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="config-title" style={{ margin: 0, border: 'none' }}>
                  <Volume2 size={22} style={{ color: 'var(--text-cyber)' }} /> Paramètres Vocaux
                </h3>
                <button 
                  onClick={() => setShowSettings(false)} 
                  className="test-voice-btn" 
                  style={{ border: 'none', background: 'transparent', padding: '0.2rem' }}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="config-group">
                <label className="config-label">Moteur vocal</label>
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
                      <span>Hauteur (Pitch)</span>
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

              <div className="config-group">
                <label className="config-label">
                  <span>Vitesse de lecture</span>
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

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button className="test-voice-btn" style={{ flexGrow: 1 }} onClick={handleTestVoice}>
                  <Volume2 size={16} /> Tester la voix
                </button>
                <button className="modal-btn primary" style={{ flexGrow: 1 }} onClick={() => setShowSettings(false)}>
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
