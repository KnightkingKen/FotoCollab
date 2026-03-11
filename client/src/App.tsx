import React, { useState, useEffect, useRef } from 'react';
import './App.css';

type View = 'auth' | 'dashboard' | 'membership' | 'account' | 'project-details' | 'community';

interface MembershipTier {
  name: string;
  price: string;
  storageLimitGB: number;
  features: string[];
}

interface Project {
  id: number;
  name: string;
  collaborators: number;
  photos: number;
}

interface FileData {
  id: number;
  projectId: number;
  url: string;
  name: string;
  type: 'image' | 'video' | 'file';
}

interface User {
  id: number;
  email: string;
}

interface Channel {
  id: number;
  name: string;
  type: 'public' | 'private';
  pin?: string;
  ownerId?: number;
}

interface Message {
  id: number;
  channelId: number;
  userEmail: string;
  content: string;
  timestamp: string;
}

function App() {
  const [view, setView] = useState<View>('auth');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileData[]>([]);
  const [isLogin, setIsLogin] = useState(true);
  const [user, setUser] = useState<{ id: number; email: string; membership: string; storageUsed: number } | null>(null);
  const [tiers, setTiers] = useState<Record<string, MembershipTier> | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  
  // Community & Chat States
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const res = await fetch('/api/config/memberships');
        setTiers(await res.json());
      } catch (e) { console.error(e); }
    };
    fetchInitialData();

    const savedUser = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (savedUser && token) {
      setUser(JSON.parse(savedUser));
      setView('dashboard');
    }
  }, []);

  useEffect(() => {
    if (user && view !== 'auth') {
      fetchChannels();
      if (view === 'dashboard') fetchProjects();
      if (view === 'community') fetchUsers('');
    }
  }, [user, view]);

  useEffect(() => {
    if (selectedChannel) {
      fetchMessages(selectedChannel.id);
      const interval = setInterval(() => fetchMessages(selectedChannel.id), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedChannel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchProjects = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setProjects(await res.json());
  };

  const fetchFiles = async (projectId: number) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/projects/${projectId}/files`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setFiles(await res.json());
  };

  const fetchUsers = async (query: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/users?search=${query}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setUsers(await res.json());
    else console.error('Failed to fetch users');
  };

  const fetchChannels = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/channels', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setChannels(data);
      if (!selectedChannel && data.length > 0) setSelectedChannel(data[0]);
    } else {
      console.error('Failed to fetch channels');
    }
  };

  const fetchMessages = async (channelId: number) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${channelId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) setMessages(await res.json());
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChannel) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${selectedChannel.id}/messages`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ content: newMessage })
    });
    if (res.ok) {
      setNewMessage('');
      fetchMessages(selectedChannel.id);
    }
  };

  const handleCreatePrivateChannel = async (targetUser: User) => {
    const name = `Chat with ${targetUser.email.split('@')[0]}`;
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const token = localStorage.getItem('token');
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ name, type: 'private', pin })
    });
    if (res.ok) {
      const newChannel = await res.json();
      alert(`Private Channel Created! PIN: ${pin}. Give this to your friend.`);
      fetchChannels();
      setSelectedChannel(newChannel);
    }
  };

  const handleJoinPrivateChannel = async () => {
    const channelId = prompt('Enter Channel ID:');
    const pin = prompt('Enter Channel PIN:');
    if (!channelId || !pin) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${channelId}/join`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ pin })
    });
    if (res.ok) {
      fetchChannels();
    } else {
      alert('Invalid ID or PIN');
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedProject || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', file.name);

    const token = localStorage.getItem('token');
    const res = await fetch(`/api/projects/${selectedProject.id}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (res.ok) fetchFiles(selectedProject.id);
    else {
      const data = await res.json();
      alert(data.message);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const endpoint = isLogin ? 'login' : 'register';
    const res = await fetch(`/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setView('dashboard');
    } else setAuthError(data.message);
  };

  const handleLogout = () => {
    localStorage.clear();
    setUser(null);
    setView('auth');
  };

  if (view === 'auth') {
    return (
      <div className="auth-section">
        <div className="auth-card">
          <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          {authError && <p className="error-text">{authError}</p>}
          <form onSubmit={handleAuth} className="auth-form">
            <div className="input-group">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="input-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="primary-btn">{isLogin ? 'Sign In' : 'Sign Up'}</button>
          </form>
          <button onClick={() => setIsLogin(!isLogin)} className="link-btn">
            {isLogin ? "No account? Sign Up" : "Have account? Login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <div className="app-main">
        <header className="navbar">
          <h1 className="logo" onClick={() => setView('dashboard')}>Foto-Collab</h1>
          <nav className="nav-links">
            <button onClick={() => setView('dashboard')} className={view === 'dashboard' ? 'active-nav' : ''}>Projects</button>
            <button onClick={() => setView('community')} className={view === 'community' ? 'active-nav' : ''}>Community</button>
            <button onClick={() => setView('membership')} className={view === 'membership' ? 'active-nav' : ''}>Plans</button>
            <button onClick={() => setView('account')} className={view === 'account' ? 'active-nav' : ''}>Account</button>
            <button onClick={() => setSidebarVisible(!sidebarVisible)} className="chat-toggle">
              {sidebarVisible ? 'Hide Chat' : 'Show Chat'}
            </button>
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </nav>
        </header>

        <main className="content-area">
          {view === 'dashboard' && (
            <div className="dashboard-view">
              <div className="view-header">
                <h2>Projects</h2>
                <button className="primary-btn" onClick={async () => {
                  const name = prompt('Project name?');
                  if (name) {
                    await fetch('/api/projects', {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}` 
                      },
                      body: JSON.stringify({ name })
                    });
                    fetchProjects();
                  }
                }}>+ New Project</button>
              </div>
              <div className="project-grid">
                {projects.map(p => (
                  <div key={p.id} className="project-card" onClick={() => { setSelectedProject(p); fetchFiles(p.id); setView('project-details'); }}>
                    <div className="project-thumb">{p.name}</div>
                    <div className="project-info"><h4>{p.name}</h4><p>{p.photos} Files</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'project-details' && selectedProject && (
            <div className="project-details-view">
              <div className="view-header">
                <button className="link-btn" onClick={() => setView('dashboard')}>← Back</button>
                <h2>{selectedProject.name}</h2>
                <label className="primary-btn">Upload File<input type="file" style={{display:'none'}} onChange={handleUploadFile} /></label>
              </div>
              <div className="file-grid">
                {files.map(f => (
                  <div key={f.id} className="file-card">
                    {f.type === 'image' ? <img src={f.url} alt={f.name} /> : <div className="file-placeholder">{f.type.toUpperCase()}</div>}
                    <div className="file-info"><p>{f.name}</p><a href={f.url} download target="_blank">Download</a></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'community' && (
            <div className="community-view">
              <h2>Community</h2>
              <div className="search-bar">
                <input type="text" placeholder="Search users by email..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); fetchUsers(e.target.value); }} />
                <button className="secondary-btn" onClick={handleJoinPrivateChannel}>Join Private Channel (PIN)</button>
              </div>
              <div className="user-list">
                {users.map(u => (
                  <div key={u.id} className="user-card">
                    <span>{u.email}</span>
                    <button className="primary-btn" onClick={() => handleCreatePrivateChannel(u)}>Start Private Chat</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'membership' && tiers && (
            <div className="membership-view">
              <h2>Membership Plans</h2>
              <div className="membership-grid">
                {Object.values(tiers).map(t => (
                  <div key={t.name} className={`membership-card ${user?.membership === t.name ? 'active' : ''}`}>
                    <h3>{t.name}</h3><div className="price">{t.price}</div><p>{t.storageLimitGB}GB Storage</p>
                    <button className="primary-btn" onClick={async () => {
                      await fetch('/api/user/membership', {
                        method: 'POST',
                        headers: { 
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${localStorage.getItem('token')}` 
                        },
                        body: JSON.stringify({ membership: t.name })
                      });
                      const updated = {...user!, membership: t.name};
                      setUser(updated);
                      localStorage.setItem('user', JSON.stringify(updated));
                    }}>{user?.membership === t.name ? 'Current' : 'Upgrade'}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'account' && user && (
            <div className="account-view">
              <h2>Account</h2>
              <div className="account-card">
                <p>Email: {user.email}</p>
                <p>Plan: {user.membership}</p>
                <p>Storage: {(user.storageUsed * 1024).toFixed(2)}MB used</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {sidebarVisible && (
        <aside className="chat-sidebar">
          <div className="chat-header">
            <h3>Channels</h3>
            <div className="channel-list">
              {channels.map(c => (
                <button key={c.id} className={`channel-btn ${selectedChannel?.id === c.id ? 'active' : ''}`} onClick={() => setSelectedChannel(c)}>
                  {c.type === 'private' ? '🔒' : '#'} {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="chat-messages">
            {messages.map(m => (
              <div key={m.id} className={`message ${m.userEmail === user?.email ? 'own' : ''}`}>
                <small>{m.userEmail.split('@')[0]}</small>
                <p>{m.content}</p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-input" onSubmit={handleSendMessage}>
            <input type="text" placeholder="Type a message..." value={newMessage} onChange={e => setNewMessage(e.target.value)} />
            <button type="submit">Send</button>
          </form>
        </aside>
      )}
    </div>
  );
}

export default App;
