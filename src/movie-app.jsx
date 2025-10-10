import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc, serverTimestamp, collection, addDoc, getDoc } from 'firebase/firestore';
import { Search, Upload, X, Tv, Film, Settings, ChevronsRight, ChevronsLeft, Play, Pause, Maximize, Minimize, AlertTriangle, Volume2, Volume1, VolumeX } from 'lucide-react';

// --- Configuration ---
// Reads the keys directly from the config.js file loaded in the browser.
const firebaseConfig = window.APP_CONFIG?.FIREBASE_CONFIG || {};
const TMDB_API_KEY = window.APP_CONFIG?.TMDB_API_KEY || null;
const appId = 'default-app-id'; // This can remain a default value
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

// WebRTC configuration - using public STUN servers
const peerConnectionConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

// --- IndexedDB Helpers for Persistence ---
const DB_NAME = 'MyFlixDB';
const DB_VERSION = 1;
const STORE_NAME = 'mediaFiles';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveFilesToDB = async (files) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear(); // Clear old files before adding new ones
        files.forEach(file => store.put(file));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const getFilesFromDB = async () => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};


// --- Helper Functions ---
const cleanMediaName = (name) => {
    return name
        .replace(/\.(mp4|mkv|avi|mov|srt|vtt)$/i, '')
        .replace(/[\._]/g, ' ')
        .replace(/\b(1080p|720p|4k|uhd|bluray|web-dl|x264|x265|aac|dts)\b/gi, '')
        .replace(/\d{4}.*$/, '')
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
    const [watchParty, setWatchParty] = useState({ id: null, isHost: false });
    const [isFirebaseReady, setIsFirebaseReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    
    const mainGridRef = useRef(null);
    const tagInputRef = useRef(null);
    const peerConnections = useRef(new Map());
    const fileInputRef = useRef(null);
    
    const processAndSetMedia = useCallback((mediaItems) => {
        const newMedia = [];
        mediaItems.forEach(item => {
            fetchMetadata(item);
            newMedia.push(item);
        });
        setMediaLibrary(newMedia);
    }, []);
    
    // Load media from DB on startup
    useEffect(() => {
        const loadFromDB = async () => {
            try {
                const files = await getFilesFromDB();
                if (files && files.length > 0) {
                    processAndSetMedia(files);
                }
            } catch (error) {
                console.error("Could not load files from database:", error);
            }
            setIsLoading(false);
        };
        loadFromDB();
    }, [processAndSetMedia]);

    // --- Firebase Initialization ---
    useEffect(() => {
        if (!firebaseConfig.apiKey) return;
        
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
            if (user) setUserId(user.uid);
            else setUserId(null);
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
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
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
        const videos = new Map();
        const subtitles = new Map();

        files.forEach(file => {
            if (file.type.startsWith('video/')) {
                const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
                videos.set(baseName, file);
            } else if (file.name.endsWith('.vtt') || file.name.endsWith('.srt')) {
                const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
                subtitles.set(baseName, file);
            }
        });

        const newMediaItems = [];
        for (const [baseName, videoFile] of videos.entries()) {
            const id = `${videoFile.name}-${videoFile.lastModified}`;
            const subtitleFile = subtitles.get(baseName) || null;
            newMediaItems.push({ id, videoFile, subtitleFile, tags: [] });
        }
        
        // Update UI immediately
        processAndSetMedia(newMediaItems);
        
        // Save to DB in the background
        saveFilesToDB(newMediaItems).catch(error => {
            console.error("Failed to save files to DB:", error);
        });
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
                mediaName: metadataCache[selectedMedia.id]?.Title || cleanMediaName(selectedMedia.videoFile.name),
                createdAt: serverTimestamp(),
            });
            setWatchParty({ id: partyId, isHost: true });
            setIsDetailView(false);
            setIsPlayerView(true);
        } catch (error) {
            console.error("Error creating watch party:", error);
        }
    };

    const joinWatchParty = (partyId) => {
        if (!isFirebaseReady || !db || !userId) return;
        setWatchParty({ id: partyId, isHost: false });
        setIsPlayerView(true);
    };

    const handleJoinPrompt = () => {
        const partyId = prompt("Enter Watch Party ID:");
        if (partyId) joinWatchParty(partyId.toUpperCase());
    };

    const leaveWatchParty = () => {
        peerConnections.current.forEach(pc => pc.close());
        peerConnections.current.clear();
        setWatchParty({ id: null, isHost: false });
        setIsPlayerView(false);
    };

    // --- Sub-components ---
    const Header = () => (
        <header className="bg-gray-800/50 backdrop-blur-sm p-4 sticky top-0 z-20 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-white tracking-wider">My<span className="text-red-500">Flix</span></h1>
            <div className="flex-1 max-w-xl relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input type="text" placeholder="Search movies, series, or tags..." className="w-full bg-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="flex items-center gap-4">
                <button onClick={handleJoinPrompt} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg" disabled={!isFirebaseReady}>Join Party</button>
                <select className="bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500" value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="year-asc">Year (Oldest)</option>
                    <option value="year-desc">Year (Newest)</option>
                </select>
                <button onClick={() => fileInputRef.current.click()} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 transition-colors">
                    <Upload size={20} /> Select Files
                </button>
            </div>
        </header>
    );

    const ApiKeyWarning = () => !TMDB_API_KEY ? ( <div className="bg-yellow-500/20 border border-yellow-600 text-yellow-300 px-4 py-3 rounded-lg relative mx-8 mb-4 flex items-center gap-3"><AlertTriangle/><div><strong>Warning:</strong> Movie metadata (posters, descriptions) is disabled.</div></div>) : null;
    const FirebaseWarning = () => !firebaseConfig.apiKey ? ( <div className="bg-blue-500/20 border border-blue-600 text-blue-300 px-4 py-3 rounded-lg relative mx-8 mb-4 flex items-center gap-3"><AlertTriangle/><div><strong>Info:</strong> Watch Party features are disabled.</div></div>) : null;
    
    const MediaItem = ({ item, isFocused }) => {
        const metadata = metadataCache[item.id];
        const title = metadata?.Title || cleanMediaName(item.videoFile.name);
        const poster = metadata?.Poster && metadata.Poster !== 'N/A' ? metadata.Poster : 'https://placehold.co/300x450/1a1a1a/FFFFFF?text=No+Image';
        return (
            <div onClick={() => handleMediaSelect(item)} className={`group cursor-pointer transition-all duration-300 transform ${isFocused ? 'scale-105 ring-4 ring-red-500 z-10' : 'hover:scale-105'}`}>
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

        const playSolo = () => {
            setIsDetailView(false);
            setWatchParty({ id: null, isHost: false });
            setIsPlayerView(true);
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
                            <div className="flex flex-wrap gap-2 mt-2"> {(selectedMedia.tags || []).map(tag => <span key={tag} className="bg-red-500/50 text-white px-2 py-1 rounded-md text-sm">{tag}</span>)} </div>
                            <form onSubmit={handleAddTag} className="flex gap-2 mt-2">
                                <input ref={tagInputRef} type="text" placeholder="Add a tag..." className="bg-gray-700 text-white rounded-md px-3 py-1 flex-grow focus:outline-none focus:ring-1 focus:ring-red-500"/>
                                <button type="submit" className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded-md">Add</button>
                            </form>
                        </div>
                        <div className="flex gap-4 mt-8">
                            <button onClick={playSolo} className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg flex-1">Play Solo</button>
                            <button onClick={createWatchParty} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg" disabled={!isFirebaseReady}>Create Watch Party</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };
    
    const VideoPlayer = () => {
        const videoRef = useRef(null);
        const [partyInfo, setPartyInfo] = useState(null);

        const isGuest = watchParty.id && !watchParty.isHost;

        useEffect(() => {
            const videoElement = videoRef.current;
            if (!videoElement) return;

            let videoUrl, subtitleUrl;

            if ((watchParty.isHost || !watchParty.id) && selectedMedia?.videoFile) {
                videoUrl = URL.createObjectURL(selectedMedia.videoFile);
                videoElement.src = videoUrl;

                // Clear existing text tracks
                Array.from(videoElement.textTracks).forEach(track => {
                    track.mode = 'disabled';
                });

                if (selectedMedia.subtitleFile) {
                    subtitleUrl = URL.createObjectURL(selectedMedia.subtitleFile);
                    const track = document.createElement('track');
                    track.kind = 'subtitles';
                    track.label = 'English';
                    track.srclang = 'en';
                    track.src = subtitleUrl;
                    track.default = true;
                    videoElement.appendChild(track);
                    track.mode = 'showing';
                }
            }
            
            return () => {
                if (videoUrl) URL.revokeObjectURL(videoUrl);
                if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
            };
        }, [selectedMedia, watchParty.isHost, watchParty.id]);

        useEffect(() => {
            if (isGuest) {
                // Guest logic...
            }
        }, [isGuest]);
        
        const partyTitle = partyInfo?.mediaName || metadataCache[selectedMedia?.id]?.Title;

        return (
            <div className="fixed inset-0 bg-black z-40 flex items-center justify-center">
                 <div className="absolute top-4 left-4 z-50">
                     <button onClick={() => { setIsPlayerView(false); leaveWatchParty(); }} className="text-white hover:text-red-500 bg-black/30 rounded-full p-2">
                        <ChevronsLeft size={32} />
                     </button>
                </div>
                <div className="absolute top-4 text-center text-white text-xl ml-4 bg-black/30 p-2 rounded-lg">{partyTitle || 'Loading...'}</div>
                {watchParty.id && <div className="absolute top-4 right-4 text-white bg-red-600 px-3 py-1 rounded-md z-50">Party ID: {watchParty.id}</div>}

                <video ref={videoRef} className="w-full h-full" crossOrigin="anonymous" playsInline controls autoPlay />
            </div>
        );
    };

    return (
        <div className="bg-gray-900 min-h-screen text-white font-sans">
            <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" />
            <Header />
            <main className="p-8">
                <ApiKeyWarning />
                <FirebaseWarning />
                {isLoading ? <div className="text-center py-20 text-gray-400">Loading...</div> : 
                 filteredMedia.length > 0 ? (
                    <div ref={mainGridRef} className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                        {filteredMedia.map((item, index) => <MediaItem key={item.id} item={item} isFocused={index === focusedIndex} />)}
                    </div>
                ) : (
                    <div className="text-center py-20">
                        <h2 className="text-2xl text-gray-400">Your media library is empty.</h2>
                        <button onClick={() => fileInputRef.current.click()} className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg flex items-center gap-2 transition-colors mx-auto">
                            <Upload size={20} /> Click here to select files
                        </button>
                    </div>
                )}
            </main>
            {isDetailView && <DetailView />}
            {isPlayerView && <VideoPlayer />}
        </div>
    );
}

