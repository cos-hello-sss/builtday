import React, { useState, useEffect } from 'react';
import { LogOut, Menu, X, Heart, MessageCircle, Plus, Upload } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, where, onSnapshot, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

// Firebase Config - Your project
const firebaseConfig = {
  apiKey: "AIzaSyAIWGFUCEmcE9rhwlKk6GvckOfLK_5qhNc",
  authDomain: "test-run-builtday.firebaseapp.com",
  projectId: "test-run-builtday",
  storageBucket: "test-run-builtday.firebasestorage.app",
  messagingSenderId: "558517457410",
  appId: "1:558517457410:web:3f1426a32df93339708d1b",
  measurementId: "G-8W8GH8DMBM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Backblaze B2 Upload Helper (proxied through Cloudflare Worker to avoid CORS)
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

const uploadToB2 = async (file, projectId) => {
  try {
    const res = await fetch(`${WORKER_URL}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': file.name,
        'X-Project-Id': projectId,
        'X-Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    if (!res.ok) throw new Error('Upload failed');
    const { publicUrl } = await res.json();
    return publicUrl;
  } catch (error) {
    console.error('Upload error:', error);
    return null;
  }
};

function Navigation({ user, onLogout, currentView, setCurrentView }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentView('feed')}>
          <div className="w-8 h-8 bg-gradient-to-br from-slate-900 to-slate-700 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">⬆️</span>
          </div>
          <span className="font-semibold text-gray-900">builtday</span>
        </div>

        <div className="hidden md:flex gap-1">
          {['feed', 'discover', 'create', 'projects'].map((view) => (
            <button
              key={view}
              onClick={() => setCurrentView(view)}
              className={`px-4 py-2 rounded-lg capitalize font-medium ${
                currentView === view ? 'bg-slate-100 text-slate-900' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {view}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <button
                onClick={() => setCurrentView('profile')}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm"
              >
                {user.displayName?.[0] || 'U'}
              </button>
              <button onClick={onLogout} className="md:flex hidden text-gray-600 hover:text-gray-900">
                <LogOut size={18} />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

function AuthView({ onSignIn }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4">
      <div className="max-w-md">
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-white text-2xl">⬆️</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">builtday</h1>
          <p className="text-gray-400">Document what you're building, one day at a time.</p>
        </div>

        <button
          onClick={onSignIn}
          className="w-full bg-white text-slate-900 py-3 rounded-xl font-bold text-lg hover:bg-gray-50 mb-6"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

function FeedView({ user }) {
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'projects'), where('visibility', '==', 'public')),
      (snap) => {
        const logs = [];
        snap.docs.forEach((projectDoc) => {
          onSnapshot(
            query(collection(db, `projects/${projectDoc.id}/logs`)),
            (logsSnap) => {
              logsSnap.docs.forEach((logDoc) => {
                logs.push({ id: logDoc.id, projectId: projectDoc.id, ...logDoc.data() });
              });
              setFeed(logs.sort((a, b) => b.createdAt?.toMillis?.() - a.createdAt?.toMillis?.()));
            }
          );
        });
      }
    );
    return unsubscribe;
  }, []);

  const moods = { Excited: '🎉', Shipping: '🚀', Learning: '📚', Stuck: '🤔', Recovering: '💪' };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {feed.length === 0 ? (
        <p className="text-center text-gray-500 mt-12">No updates yet</p>
      ) : (
        feed.map((log) => (
          <div key={log.id} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">{log.title || 'Untitled'}</h3>
                <p className="text-sm text-gray-500 mt-1">{log.createdAt?.toDate?.().toLocaleDateString()}</p>
              </div>
              <span className="text-2xl">{moods[log.mood]}</span>
            </div>
            <p className="text-gray-700 mb-4">{log.content}</p>
            {log.mediaUrls?.length > 0 && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {log.mediaUrls.map((url, i) => (
                  <img key={i} src={url} alt="Upload" className="rounded-lg h-40 object-cover" />
                ))}
              </div>
            )}
            {log.isMilestone && <div className="inline-block bg-yellow-50 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold mb-4">⭐ Milestone</div>}
          </div>
        ))
      )}
    </div>
  );
}

function CreateLogView({ projects, user }) {
  const [selectedProject, setSelectedProject] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('Learning');
  const [isMilestone, setIsMilestone] = useState(false);
  const [mediaUrls, setMediaUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleMediaUpload = async (e) => {
    const files = Array.from(e.target.files);
    setUploading(true);
    
    for (const file of files) {
      const url = await uploadToB2(file, selectedProject);
      if (url) {
        setMediaUrls([...mediaUrls, url]);
      }
    }
    
    setUploading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedProject || !content) return;

    setLoading(true);
    try {
      await addDoc(collection(db, `projects/${selectedProject}/logs`), {
        title,
        content,
        mood,
        isMilestone,
        mediaUrls,
        createdAt: serverTimestamp(),
        reactions: {},
      });
      setTitle('');
      setContent('');
      setMood('Learning');
      setIsMilestone(false);
      setMediaUrls([]);
      setSelectedProject('');
      alert('Log created!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Document today</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Project</label>
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg">
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What happened?" className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Update</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What are you working on?" rows={6} className="w-full px-4 py-2 border border-gray-300 rounded-lg resize-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">How are you feeling?</label>
            <div className="grid grid-cols-5 gap-2">
              {['Excited', 'Shipping', 'Learning', 'Stuck', 'Recovering'].map((m) => (
                <button key={m} type="button" onClick={() => setMood(m)} className={`p-3 rounded-lg font-medium ${mood === m ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Media (optional)</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input type="file" multiple accept="image/*,video/*" onChange={handleMediaUpload} className="hidden" id="media-upload" />
              <label htmlFor="media-upload" className="cursor-pointer">
                <Upload className="mx-auto mb-2 text-gray-400" size={24} />
                <p className="text-sm text-gray-600">Click to upload media</p>
              </label>
            </div>
            {uploading && <p className="text-sm text-gray-500 mt-2">Uploading...</p>}
            {mediaUrls.length > 0 && <p className="text-sm text-green-600 mt-2">✓ {mediaUrls.length} file(s) uploaded</p>}
          </div>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={isMilestone} onChange={(e) => setIsMilestone(e.target.checked)} className="w-5 h-5" />
            <span className="text-gray-700">Milestone</span>
          </label>
          <button type="submit" disabled={loading || !selectedProject || !content} className="w-full bg-slate-900 text-white py-3 rounded-lg font-bold">
            {loading ? 'Saving...' : 'Share Update'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProjectsView({ user }) {
  const [userProjects, setUserProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectCategory, setNewProjectCategory] = useState('Startup');
  const [creatingProject, setCreatingProject] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'projects'), where('ownerId', '==', user.uid)),
      (snap) => setUserProjects(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
    );
    return unsubscribe;
  }, [user]);

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreatingProject(true);
    try {
      await addDoc(collection(db, 'projects'), {
        ownerId: user.uid,
        title: newProjectName,
        description: newProjectDesc,
        category: newProjectCategory,
        visibility: 'public',
        streakCount: 0,
        followersCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewProjectName('');
      setNewProjectDesc('');
      setNewProjectCategory('Startup');
      alert('Project created!');
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Projects</h2>
      
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h3 className="font-bold text-lg mb-4">Create New Project</h3>
        <form onSubmit={handleCreateProject} className="space-y-4">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
          <textarea
            value={newProjectDesc}
            onChange={(e) => setNewProjectDesc(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg resize-none"
          />
          <select
            value={newProjectCategory}
            onChange={(e) => setNewProjectCategory(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          >
            {['Startup', 'Art', 'Learning', 'Research', 'GameDev', 'Other'].map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={creatingProject}
            className="w-full bg-slate-900 text-white py-2 rounded-lg font-bold"
          >
            {creatingProject ? 'Creating...' : 'Create Project'}
          </button>
        </form>
      </div>

      {userProjects.length === 0 ? (
        <p className="text-gray-500">No projects yet. Create one above!</p>
      ) : (
        <div className="grid gap-4">
          {userProjects.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-bold text-lg">{p.title}</h3>
              <p className="text-gray-600 mt-2">{p.description}</p>
              <p className="text-sm text-gray-500 mt-2">Category: {p.category}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiscoverView() {
  const [publicProjects, setPublicProjects] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'projects'), where('visibility', '==', 'public')),
      (snap) => setPublicProjects(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
    );
    return unsubscribe;
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Discover</h2>
      {publicProjects.length === 0 ? (
        <p className="text-gray-500">No public projects yet</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {publicProjects.map((p) => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-bold text-lg">{p.title}</h3>
              <p className="text-gray-600 text-sm">{p.description}</p>
              <p className="text-sm text-gray-500 mt-2">Category: {p.category}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileView({ user }) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 p-8 mb-8">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-2xl">
            {user?.displayName?.[0]}
          </div>
          <div>
            <h1 className="text-3xl font-bold">{user?.displayName}</h1>
            <p className="text-gray-500">{user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('feed');
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        const userDoc = await getDoc(doc(db, 'users', authUser.uid));
        if (userDoc.exists()) {
          setUser({ uid: authUser.uid, ...userDoc.data() });
        } else {
          await setDoc(doc(db, 'users', authUser.uid), {
            email: authUser.email,
            displayName: authUser.displayName || 'Builder',
            createdAt: serverTimestamp(),
          });
          setUser({
            uid: authUser.uid,
            email: authUser.email,
            displayName: authUser.displayName || 'Builder',
          });
        }

        const unsubProjects = onSnapshot(
          query(collection(db, 'projects'), where('ownerId', '==', authUser.uid)),
          (snap) => setProjects(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
        );
        return () => unsubProjects();
      } else {
        setUser(null);
        setProjects([]);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView onSignIn={() => signInWithPopup(auth, googleProvider)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation user={user} onLogout={() => { signOut(auth); setCurrentView('feed'); }} currentView={currentView} setCurrentView={setCurrentView} />
      <main className="pt-20 pb-12 px-4">
        {currentView === 'feed' && <FeedView user={user} />}
        {currentView === 'create' && <CreateLogView user={user} projects={projects} />}
        {currentView === 'projects' && <ProjectsView user={user} />}
        {currentView === 'discover' && <DiscoverView />}
        {currentView === 'profile' && <ProfileView user={user} />}
      </main>
    </div>
  );
}

export default App;
