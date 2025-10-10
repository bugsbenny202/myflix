import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Search, Upload, X, Tv, Film, Settings, ChevronsRight, ChevronsLeft, Play, Pause, Maximize, Minimize, AlertTriangle } from 'lucide-react';

// --- Configuration ---
// This more direct approach is robust for Vercel's build environment.
const firebaseConfigString = process.env.REACT_APP_FIREBASE_CONFIG || '{}';
let firebaseConfig = {};
try {
    // Safely parse the Firebase config string
    firebaseConfig = JSON.parse(firebaseConfigString);
} catch (e) {
    console.error("Could not parse Firebase config. Ensure it's a valid JSON string in your environment variables.", e);
}

const TMDB_API_KEY = process.env.REACT_APP_TMDB_API_KEY || null;
const appId = process.env.REACT_APP_ID || 'default-app-id';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

// --- Helper Functions ---
const cleanMediaName = (name) => {
    // Tries to clean up a file name to get a searchable movie/series title.
    return name
        .replace(/\.(mp4|mkv|avi|mov|srt|vtt)$/i, '') // Remove file extensions
        .replace(/[\._]/g, ' ') // Replace dots and underscores with spaces
        .replace(/\b(1080p|720p|4k|uhd|bluray|web-dl|x264|x265|aac|dts)\b/gi, '') // Remove quality tags
        .replace(/\d{4}.*$/, '') // Remove year and everything after
        .trim();
};


// --- Main Application Component ---
export default function App() {
    // --- State Management ---
    const [mediaLibrary, setMediaLibrary] = useState([]);
    const [filteredMedia, setFilteredMedia] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('title-asc');
    const [selectedMedia, setSelectedMedia] = useState(null);
    const [isDetailView, setIsDetailView] = useState(false);
    const [isPlayerView, setIsPlayerView] = useState(false);
    const [metadataCache, setMetadataCache] = useState({});
    const [focusedIndex, setFocusedIndex] = useState(0);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [watchParty, setWatchParty] = useState({ id: null, isHost: false, unsubscribe: null });
    const [isFirebaseReady, setIsFirebaseReady] = useState(false);

    const fileInputRef = useRef(null);
    const mainGridRef = useRef(null);
    const tagInputRef = useRef(null);

    // --- Firebase Initialization ---
    useEffect(() => {
        if (!firebaseConfig.apiKey) {
            return;
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const fireAuth = getAuth(app);
        setDb(firestore);
        setAuth(fireAuth);

        const authenticate = async () => {
            try {
                await signInAnonymously(fireAuth);
                setIsFirebaseReady(true);
            } catch (error) {
                 console.error("Authentication failed:", error);
            }
        };

        authenticate();

        const unsubscribe = onAuthStateChanged(fireAuth, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(null);
            }
        });

        return () => unsubscribe();
    }, []);

    // --- Media Processing and Sorting ---
    useEffect(() => {
        let processed = mediaLibrary
            .filter(item => {
                const title = metadataCache[item.id]?.Title || cleanMediaName(item.videoFile.name);
                return title.toLowerCase().includes(searchTerm.toLowerCase()) || (item.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
            });

        processed.sort((a, b) => {
            const titleA = metadataCache[a.id]?.Title || '';
            const titleB = metadataCache[b.id]?.Title || '';
            const yearA = parseInt(metadataCache[a.id]?.Year || 0);
            const yearB = parseInt(metadataCache[b.id]?.Year || 0);

            switch (sortOption) {
                case 'title-asc': return titleA.localeCompare(titleB);
                case 'title-desc': return titleB.localeCompare(titleA);
                case 'year-asc': return yearA - yearB;
                case 'year-desc': return yearB - yearA;
                default: return 0;
            }
        });

        setFilteredMedia(processed);
        setFocusedIndex(0);
    }, [mediaLibrary, searchTerm, sortOption, metadataCache]);

    // --- Controller and Keyboard Navigation ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isDetailView || isPlayerView) return;

            const gridItems = mainGridRef.current?.children;
            if (!gridItems || gridItems.length === 0) return;
            
            const gridComputedStyle = window.getComputedStyle(mainGridRef.current);
            const gridTemplateColumns = gridComputedStyle.getPropertyValue('grid-template-columns');
            const columns = gridTemplateColumns.split(' ').length;

            let newIndex = focusedIndex;
            switch (e.key) {
                case 'ArrowRight': newIndex = Math.min(filteredMedia.length - 1, focusedIndex + 1); break;
                case 'ArrowLeft': newIndex = Math.max(0, focusedIndex - 1); break;
                case 'ArrowDown': newIndex = Math.min(filteredMedia.length - 1, focusedIndex + columns); break;
                case 'ArrowUp': newIndex = Math.max(0, focusedIndex - columns); break;
                case 'Enter':
                    handleMediaSelect(filteredMedia[focusedIndex]);
                    e.preventDefault();
                    return;
                default: return;
            }

            e.preventDefault();
            setFocusedIndex(newIndex);
            gridItems[newIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        const intervalId = setInterval(() => {
            const gamepads = navigator.getGamepads();
            if (gamepads[0]) {
                const gp = gamepads[0];
                if (gp.buttons[14].pressed) handleKeyDown({ key: 'ArrowLeft', preventDefault: () => {} });
                if (gp.buttons[15].pressed) handleKeyDown({ key: 'ArrowRight', preventDefault: () => {} });
                if (gp.buttons[12].pressed) handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
                if (gp.buttons[13].pressed) handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
                if (gp.buttons[0].pressed) handleKeyDown({ key: 'Enter', preventDefault: () => {} });
            }
        }, 150);

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            clearInterval(intervalId);
        };
    }, [focusedIndex, filteredMedia, isDetailView, isPlayerView]);


    // --- Core Functions ---
    const fetchMetadata = async (item) => {
        if (metadataCache[item.id] || !TMDB_API_KEY) return;

        const title = cleanMediaName(item.videoFile.name);
        try {
            const searchResponse = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`);
            const searchData = await searchResponse.json();
            const movieResult = searchData.results?.[0];

            if (!movieResult) return;

            const detailsResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieResult.id}?api_key=${TMDB_API_KEY}&append_to_response=release_dates`);
            const detailsData = await detailsResponse.json();

            const usRelease = detailsData.release_dates?.results?.find(r => r.iso_3166_1 === 'US');
            const rating = usRelease?.release_dates?.find(rd => rd.certification)?.certification || 'N/A';

            const normalizedData = {
                Title: detailsData.title,
                Year: detailsData.release_date ? detailsData.release_date.substring(0, 4) : 'N/A',
                Rated: rating,
                Runtime: `${detailsData.runtime} min`,
                Plot: detailsData.overview,
                Poster: detailsData.poster_path ? `${TMDB_IMAGE_BASE_URL}${detailsData.poster_path}` : 'https://placehold.co/300x450/1a1a1a/FFFFFF?text=No+Image',
                Type: 'movie',
            };
            
            setMetadataCache(prev => ({ ...prev, [item.id]: normalizedData }));

        } catch (error) {
            console.error("Failed to fetch TMDB metadata:", error);
        }
    };

    const handleFileUpload = (e) => {
        const files = Array.from(e.target.files);
        const videos = files.filter(f => f.type.startsWith('video/'));
        const subtitles = files.filter(f => f.name.endsWith('.vtt') || f.name.endsWith('.srt'));

        const newMedia = videos.map(videoFile => {
            const id = `${videoFile.name}-${videoFile.lastModified}`;
            const videoBaseName = videoFile.name.substring(0, videoFile.name.lastIndexOf('.'));
            const subtitleFile = subtitles.find(s => s.name.startsWith(videoBaseName));
            
            const newItem = { id, videoFile, subtitleFile, tags: [] };
            fetchMetadata(newItem);
            return newItem;
        });

        setMediaLibrary(prev => [...prev, ...newMedia]);
    };

    const handleMediaSelect = (media) => {
        setSelectedMedia(media);
        setIsDetailView(true);
    };

    const addTag = (mediaId, tag) => {
        if (!tag) return;
        setMediaLibrary(lib => lib.map(item =>
            item.id === mediaId ? { ...item, tags: [...new Set([...(item.tags || []), tag])] } : item
        ));
    };

    // --- Watch Party Functions ---
    const createWatchParty = async () => {
        if (!db || !userId || !selectedMedia || !isFirebaseReady) return;
        const partyId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const partyRef = doc(db, "artifacts", appId, "public", "data", "watch_parties", partyId);
        try {
            await setDoc(partyRef, {
                hostId: userId,
                mediaName: selectedMedia.videoFile.name,
                isPlaying: false,
                currentTime: 0,
                lastUpdated: serverTimestamp(),
                participants: [userId]
            });
            joinWatchParty(partyId, true);
            setIsPlayerView(true);
        } catch (error) {
            console.error("Error creating watch party:", error);
        }
    };

    const joinWatchParty = (partyId, isHost = false) => {
        if (!isFirebaseReady || !db || !userId) return;
        if (watchParty.unsubscribe) watchParty.unsubscribe();

        const partyRef = doc(db, "artifacts", appId, "public", "data", "watch_parties", partyId);
        const unsubscribe = onSnapshot(partyRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                if (!data.participants?.includes(userId)) {
                    updateDoc(partyRef, {
                        participants: [...(data.participants || []), userId]
                    });
                }
            }
        });
        
        setWatchParty({ id: partyId, isHost, unsubscribe });
        setIsPlayerView(true);
    };

    const handleJoinPrompt = () => {
        const partyId = prompt("Enter Watch Party ID:");
        if (partyId) {
            joinWatchParty(partyId.toUpperCase());
        }
    };

    const leaveWatchParty = () => {
        if (watchParty.unsubscribe) watchParty.unsubscribe();
        setWatchParty({ id: null, isHost: false, unsubscribe: null });
        setIsPlayerView(false);
    };
    

    // --- Sub-components ---
    const Header = () => (
        <header className="bg-gray-800/50 backdrop-blur-sm p-4 sticky top-0 z-20 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-white tracking-wider">My<span className="text-red-500">Flix</span></h1>
            <div className="flex-1 max-w-xl relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search movies, series, or tags..."
                    className="w-full bg-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <div className="flex items-center gap-4">
                <select
                    className="bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value)}
                >
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="year-asc">Year (Oldest)</option>
                    <option value="year-desc">Year (Newest)</option>
                </select>
                <button
                    onClick={() => fileInputRef.current.click()}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors"
                >
                    <Upload size={20} /> Upload
                </button>
            </div>
        </header>
    );

    const ApiKeyWarning = () => !TMDB_API_KEY ? (
        <div className="bg-yellow-500/20 border border-yellow-600 text-yellow-300 px-4 py-3 rounded-lg relative mx-8 mb-4 flex items-center gap-3">
            <AlertTriangle/>
            <div><strong>Warning:</strong> Movie metadata (posters, descriptions) is disabled because the TMDB API key is not configured.</div>
        </div>
    ) : null;

    const FirebaseWarning = () => !firebaseConfig.apiKey ? (
        <div className="bg-blue-500/20 border border-blue-600 text-blue-300 px-4 py-3 rounded-lg relative mx-8 mb-4 flex items-center gap-3">
            <AlertTriangle/>
            <div><strong>Info:</strong> Watch Party features are disabled. To enable them, set up your Firebase configuration when deploying the app.</div>
        </div>
    ) : null;

    const MediaItem = ({ item, isFocused }) => {
        const metadata = metadataCache[item.id];
        const title = metadata?.Title || cleanMediaName(item.videoFile.name);
        const poster = metadata?.Poster && metadata.Poster !== 'N/A' ? metadata.Poster : 'https://placehold.co/300x450/1a1a1a/FFFFFF?text=No+Image';

        return (
            <div
                onClick={() => handleMediaSelect(item)}
                className={`group cursor-pointer transition-all duration-300 transform ${isFocused ? 'scale-105 ring-4 ring-red-500 z-10' : 'hover:scale-105'}`}
            >
                <img src={poster} alt={title} className="w-full h-auto object-cover rounded-lg shadow-lg" />
                <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4 rounded-lg">
                    <h3 className="text-white font-bold text-lg">{title}</h3>
                    {metadata?.Year && <p className="text-gray-300">{metadata.Year}</p>}
                </div>
            </div>
        );
    };

    const DetailView = () => {
        if (!selectedMedia) return null;

        const metadata = metadataCache[selectedMedia.id] || {};
        const title = metadata.Title || cleanMediaName(selectedMedia.videoFile.name);
        const poster = metadata.Poster && metadata.Poster !== 'N/A' ? metadata.Poster : 'https://placehold.co/300x450/1a1a1a/FFFFFF?text=No+Image';

        const handleAddTag = (e) => {
            e.preventDefault();
            addTag(selectedMedia.id, tagInputRef.current.value);
            tagInputRef.current.value = '';
        };

        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-lg z-30 flex items-center justify-center p-4" onClick={() => setIsDetailView(false)}>
                <div className="bg-gray-900 rounded-xl max-w-4xl w-full flex gap-8 p-8 relative overflow-hidden" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setIsDetailView(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={28} /></button>
                    <img src={poster} alt={title} className="w-1/3 rounded-lg shadow-2xl" />
                    <div className="w-2/3 flex flex-col">
                        <span className="text-red-500 font-semibold flex items-center gap-2">{metadata.Type === 'series' ? <Tv /> : <Film />} {metadata.Type?.toUpperCase()}</span>
                        <h2 className="text-4xl font-bold text-white mt-2">{title}</h2>
                        <div className="flex items-center gap-4 text-gray-400 mt-2">
                            <span>{metadata.Year}</span>
                            <span className="border-l border-gray-600 pl-4">{metadata.Rated}</span>
                            <span className="border-l border-gray-600 pl-4">{metadata.Runtime}</span>
                        </div>
                        <p className="text-gray-300 mt-6 flex-grow overflow-y-auto max-h-40">{metadata.Plot || 'No description available.'}</p>
                        
                        <div className="mt-4">
                            <p className="text-white font-semibold">Tags:</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {(selectedMedia.tags || []).map(tag => <span key={tag} className="bg-red-500/50 text-white px-2 py-1 rounded-md text-sm">{tag}</span>)}
                            </div>
                            <form onSubmit={handleAddTag} className="flex gap-2 mt-2">
                                <input ref={tagInputRef} type="text" placeholder="Add a tag..." className="bg-gray-700 text-white rounded-md px-3 py-1 flex-grow focus:outline-none focus:ring-1 focus:ring-red-500"/>
                                <button type="submit" className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded-md">Add</button>
                            </form>
                        </div>

                        <div className="flex gap-4 mt-8">
                            <button onClick={() => { setIsDetailView(false); setIsPlayerView(true); }} className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg flex-1">Play</button>
                            <button onClick={createWatchParty} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg" disabled={!isFirebaseReady}>Create Watch Party</button>
                            <button onClick={handleJoinPrompt} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg" disabled={!isFirebaseReady}>Join Party</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };
    
    const VideoPlayer = () => {
        const videoRef = useRef(null);
        const playerContainerRef = useRef(null);
        const [isPlaying, setIsPlaying] = useState(false);
        const [progress, setProgress] = useState(0);
        const [duration, setDuration] = useState(0);
        const [isSettingsOpen, setIsSettingsOpen] = useState(false);
        const [subtitleSettings, setSubtitleSettings] = useState({ color: '#FFFFFF', size: 24, background: 'rgba(0,0,0,0.5)' });
        const [partyState, setPartyState] = useState(null);
        const [isFullScreen, setIsFullScreen] = useState(false);
        const [isFullScreenSupported, setIsFullScreenSupported] = useState(false);
        const isSyncing = useRef(false);
        const controlsTimeout = useRef(null);
        
        useEffect(() => {
            setIsFullScreenSupported(!!document.fullscreenEnabled);
        }, []);

        const videoSrc = selectedMedia ? URL.createObjectURL(selectedMedia.videoFile) : null;
        const subtitleSrc = selectedMedia?.subtitleFile ? URL.createObjectURL(selectedMedia.subtitleFile) : null;

        const updatePartyState = useCallback(async (state) => {
            if (watchParty.id && watchParty.isHost && isFirebaseReady) {
                const partyRef = doc(db, "artifacts", appId, "public", "data", "watch_parties", watchParty.id);
                await updateDoc(partyRef, { ...state, lastUpdated: serverTimestamp() });
            }
        }, [watchParty.id, watchParty.isHost, db, isFirebaseReady]);

        useEffect(() => {
            if (!watchParty.id || !isFirebaseReady) return;
            const partyRef = doc(db, "artifacts", appId, "public", "data", "watch_parties", watchParty.id);
            const unsubscribe = onSnapshot(partyRef, (doc) => {
                if(doc.exists()) setPartyState(doc.data());
            });
            return () => unsubscribe();
        }, [watchParty.id, db, isFirebaseReady]);

        useEffect(() => {
            const syncPlayer = async () => {
                if (!videoRef.current || watchParty.isHost || !partyState || isSyncing.current) return;
                
                isSyncing.current = true;
                const video = videoRef.current;
                if (Math.abs(video.currentTime - partyState.currentTime) > 2) {
                    video.currentTime = partyState.currentTime;
                }
                if (partyState.isPlaying && video.paused) {
                    try { await video.play(); } catch (e) { if(e.name !== 'AbortError') console.error(e); }
                } else if (!partyState.isPlaying && !video.paused) {
                    video.pause();
                }
                isSyncing.current = false;
            };
            syncPlayer();
        }, [partyState, watchParty.isHost]);


        const togglePlay = () => {
            if (videoRef.current.paused) videoRef.current.play();
            else videoRef.current.pause();
        };

        const handleTimeUpdate = () => {
            if (!videoRef.current) return;
            setProgress(videoRef.current.currentTime);
            if(watchParty.isHost && Math.abs(videoRef.current.currentTime - (partyState?.currentTime || 0)) > 5) {
                updatePartyState({ currentTime: videoRef.current.currentTime });
            }
        };

        const handleSeek = (e) => {
            if (watchParty.id && !watchParty.isHost) return;
            const seekTime = (e.nativeEvent.offsetX / e.target.clientWidth) * duration;
            videoRef.current.currentTime = seekTime;
            updatePartyState({ currentTime: seekTime });
        };
        
        const toggleFullScreen = () => {
            if (!isFullScreenSupported) return;
            try {
                if (!document.fullscreenElement) playerContainerRef.current.requestFullscreen();
                else document.exitFullscreen();
                setIsFullScreen(!!document.fullscreenElement);
            } catch (error) {
                console.error("Fullscreen request failed:", error);
            }
        };

        useEffect(() => {
            const vid = videoRef.current;
            if (!vid) return;

            const onPlay = () => { setIsPlaying(true); if (watchParty.isHost) updatePartyState({ isPlaying: true }); };
            const onPause = () => { setIsPlaying(false); if (watchParty.isHost) updatePartyState({ isPlaying: false }); };
            
            vid.addEventListener('play', onPlay);
            vid.addEventListener('pause', onPause);
            vid.addEventListener('timeupdate', handleTimeUpdate);
            vid.addEventListener('loadedmetadata', () => setDuration(vid.duration));

            return () => {
                vid.removeEventListener('play', onPlay);
                vid.removeEventListener('pause', onPause);
            };
        }, [updatePartyState, watchParty.isHost]);

        if (!selectedMedia) return null;

        return (
            <div ref={playerContainerRef} className="fixed inset-0 bg-black z-40 flex items-center justify-center">
                <video ref={videoRef} className="w-full h-full" autoPlay>
                    <source src={videoSrc} type={selectedMedia.videoFile.type} />
                    {subtitleSrc && <track label="English" kind="subtitles" srcLang="en" src={subtitleSrc} default />}
                </video>
                <div className="absolute inset-0">
                    <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/70 to-transparent flex justify-between items-center">
                         <div>
                            <button onClick={() => { setIsPlayerView(false); leaveWatchParty(); }} className="text-white hover:text-red-500"><ChevronsLeft size={32} /></button>
                            <span className="text-white text-xl ml-4">{metadataCache[selectedMedia.id]?.Title || '...'}</span>
                         </div>
                         {watchParty.id && <div className="text-white bg-red-600 px-3 py-1 rounded-md">Party ID: {watchParty.id}</div>}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
                        <div className={`w-full h-1.5 bg-gray-600 ${watchParty.id && !watchParty.isHost ? 'cursor-not-allowed' : 'cursor-pointer'}`} onClick={handleSeek}>
                            <div className="h-full bg-red-500" style={{ width: `${(progress / duration) * 100}%` }}></div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-4">
                                <button onClick={togglePlay} className="text-white" disabled={watchParty.id && !watchParty.isHost}>{isPlaying ? <Pause size={28}/> : <Play size={28}/>}</button>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setIsSettingsOpen(s => !s)} className="text-white"><Settings size={24}/></button>
                                {isFullScreenSupported && <button onClick={toggleFullScreen} className="text-white">{isFullScreen ? <Minimize size={24}/> : <Maximize size={24}/>}</button>}
                            </div>
                        </div>
                    </div>
                </div>
                {isSettingsOpen && (
                    <div className="absolute right-4 bottom-20 bg-gray-800/80 p-4 rounded-lg backdrop-blur-sm">
                         <h4 className="text-white font-bold mb-2">Subtitle Settings</h4>
                         <div className="grid grid-cols-2 gap-2 text-white items-center">
                            <label>Color:</label> <input type="color" value={subtitleSettings.color} onChange={e => setSubtitleSettings(s => ({...s, color: e.target.value}))} />
                            <label>Size:</label> <input type="range" min="12" max="48" value={subtitleSettings.size} onChange={e => setSubtitleSettings(s => ({...s, size: parseInt(e.target.value)}))} />
                            <label>Background:</label> <input type="color" value={subtitleSettings.background} onChange={e => setSubtitleSettings(s => ({...s, background: e.target.value}))} />
                         </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="bg-gray-900 min-h-screen text-white font-sans">
            <input type="file" multiple webkitdirectory="" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <Header />
            <main className="p-8">
                <ApiKeyWarning />
                <FirebaseWarning />
                {filteredMedia.length > 0 ? (
                    <div ref={mainGridRef} className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                        {filteredMedia.map((item, index) => <MediaItem key={item.id} item={item} isFocused={index === focusedIndex} />)}
                    </div>
                ) : (
                    <div className="text-center py-20">
                        <h2 className="text-2xl text-gray-400">Your media library is empty.</h2>
                        <button
                            onClick={() => fileInputRef.current.click()}
                            className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg flex items-center gap-2 transition-colors mx-auto"
                        >
                            <Upload size={20} /> Click here to upload a folder
                        </button>
                    </div>
                )}
            </main>
            {isDetailView && <DetailView />}
            {isPlayerView && <VideoPlayer />}
        </div>
    );
}

