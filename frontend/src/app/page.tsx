'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import {
  LayoutDashboard, Send, MessageSquare, Settings, LogOut,
  Instagram, Play, Pause, XCircle, Plus, RefreshCw,
  CheckCircle2, AlertCircle, Clock, Activity, Globe, Loader2, X, ExternalLink
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type Job = {
  id: string;
  interactionId: string;
  message: string;
  status: string;
  errorMsg?: string | null;
  executedAt?: string | null;
};
type Campaign = {
  id: string; name: string; type: string; status: string;
  createdAt: string; delayMin: number; delayMax: number;
  hourlyLimit: number; total: number; done: number; failed: number; queued: number;
  jobs?: Job[];
};
type User = { id: string; name: string; email: string };
type Session = { id: string; username: string; proxyUrl?: string };

// ─── API base resolver ────────────────────────────────────────────────────────
let API = 'http://127.0.0.1:5000';
async function resolveApi(): Promise<string> {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { electron?: { getBackendPort: () => Promise<number> } };
    if (w.electron?.getBackendPort) {
      try { API = `http://127.0.0.1:${await w.electron.getBackendPort()}`; }
      catch { /* keep default */ }
    }
  }
  return API;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    RUNNING: 'badge-green', QUEUED: 'badge-yellow', COMPLETED: 'badge-purple',
    PAUSED: 'badge-gray', FAILED: 'badge-red', CANCELLED: 'badge-red',
    DONE: 'badge-green',
  };
  return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{status}</span>;
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tab, setTab] = useState<'dashboard' | 'dm' | 'comment' | 'settings'>('dashboard');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // New campaign form
  const [form, setForm] = useState({
    name: '', type: 'DM',
    targets: '', messages: '',
    delayMin: 8, delayMax: 20, hourlyLimit: 15,
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formErr, setFormErr] = useState('');

  // Settings form
  const [settings, setSettings] = useState({ delayMin: 8, delayMax: 20, hourlyLimit: 15 });
  const [settingsSaved, setSettingsSaved] = useState(false);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedToken = localStorage.getItem('token');
    if (!storedToken) {
      localStorage.removeItem('user');
      router.push('/signin');
      return;
    }

    setLoading(true);
    resolveApi().then(async (apiBase) => {
      try {
        // Cryptographically verify the session token with rolling 7-day refresh logic
        const { data } = await axios.get(`${apiBase}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${storedToken}` }
        });
        
        // Save the refreshed rolling token and user profile
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        setUser(data.user);
        fetchAll(data.user.id);
      } catch (err) {
        console.error('[Auth] Inactivity limit reached or token tampered. Redirecting...', err);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.push('/signin');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = useCallback(async (uid: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [campRes, sessRes, setRes] = await Promise.all([
        axios.get(`${API}/api/campaigns/user/${uid}`),
        axios.get(`${API}/api/instagram/status/${uid}`),
        axios.get(`${API}/api/settings/${uid}`),
      ]);
      setCampaigns(campRes.data);
      setSession(sessRes.data.connected ? sessRes.data.session : null);
      setSettings(setRes.data);
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  }, []);

  // Fetch details for selected campaign
  const fetchCampaignDetails = useCallback(async (id: string) => {
    setLoadingDetails(true);
    try {
      const res = await axios.get(`${API}/api/campaigns/${id}`);
      setSelectedCampaign(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCampaignId) {
      fetchCampaignDetails(selectedCampaignId);
    } else {
      setSelectedCampaign(null);
    }
  }, [selectedCampaignId, fetchCampaignDetails]);

  // Auto-refresh every 8s (silent in background)
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      fetchAll(user.id, true);
      if (selectedCampaignId) {
        fetchCampaignDetails(selectedCampaignId);
      }
    }, 8000);
    return () => clearInterval(t);
  }, [user, selectedCampaignId, fetchAll, fetchCampaignDetails]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const connectInstagram = async () => {
    if (!user) return;
    setConnecting(true);
    try { await axios.post(`${API}/api/instagram/connect`, { userId: user.id }); fetchAll(user.id, true); }
    catch (e) { console.error(e); }
    finally { setConnecting(false); }
  };

  const disconnectInstagram = async () => {
    if (!user) return;
    await axios.post(`${API}/api/instagram/disconnect`, { userId: user.id });
    setSession(null);
  };

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    let targets: string[] = [];
    if (form.type === 'COMMENT') {
      // Bulletproof split and clean for sticky URLs
      const paddedInput = form.targets.replace(/https?:\/\//g, ' https://');
      const urlRegex = /(https?:\/\/[^\s,]+)/g;
      let match;
      while ((match = urlRegex.exec(paddedInput)) !== null) {
        targets.push(match[0].trim());
      }
    } else {
      // Username splitting
      targets = form.targets.split(/[\n, ]+/).map(s => s.trim()).filter(Boolean);
    }

    const messages = form.messages.split('\n').map(s => s.trim()).filter(Boolean);
    
    if (!form.name || !targets.length || !messages.length) {
      setFormErr('Fill in name, targets, and at least one message.'); return;
    }
    setFormLoading(true); setFormErr('');
    try {
      await axios.post(`${API}/api/campaigns`, {
        userId: user.id, name: form.name, type: form.type,
        links: targets, messages,
        delayMin: form.delayMin, delayMax: form.delayMax, hourlyLimit: form.hourlyLimit,
      });
      setShowNewCampaign(false);
      setForm({ name:'', type:'DM', targets:'', messages:'', delayMin:8, delayMax:20, hourlyLimit:15 });
      fetchAll(user.id, true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setFormErr(e.response?.data?.error || 'Failed to create campaign');
    } finally { setFormLoading(false); }
  };

  const campaignAction = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
    await axios.patch(`${API}/api/campaigns/${id}/${action}`);
    if (user) fetchAll(user.id, true);
  };

  const saveSettings = async () => {
    if (!user) return;
    await axios.patch(`${API}/api/settings/${user.id}`, settings);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  const logout = () => {
    localStorage.clear();
    router.push('/signin');
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalDone = campaigns.reduce((a, c) => a + c.done, 0);
  const totalFailed = campaigns.reduce((a, c) => a + c.failed, 0);
  const running = campaigns.filter(c => c.status === 'RUNNING').length;

  if (loading && !campaigns.length) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', gap:12, color:'var(--text-muted)' }}>
        <Loader2 size={20} className="pulse" /> Loading...
      </div>
    );
  }

  // ── Sidebar nav items ──────────────────────────────────────────────────────
  const navItems = [
    { key:'dashboard', icon:<LayoutDashboard size={17}/>, label:'Dashboard' },
    { key:'dm',        icon:<Send size={17}/>,            label:'DM Bot' },
    { key:'comment',   icon:<MessageSquare size={17}/>,   label:'Comment Bot' },
    { key:'settings',  icon:<Settings size={17}/>,        label:'Settings' },
  ];

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><Instagram size={18} color="white"/></div>
          <div>
            <div className="logo-text">Vuducom DM</div>
            <div className="logo-sub">AUTOMATION</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Navigation</div>
          {navItems.map(n => (
            <button key={n.key} className={`nav-item ${tab === n.key ? 'active' : ''}`}
              onClick={() => { setTab(n.key as typeof tab); if(n.key==='dm') setForm(f=>({...f,type:'DM'})); if(n.key==='comment') setForm(f=>({...f,type:'COMMENT'})); }}>
              {n.icon} {n.label}
            </button>
          ))}
        </nav>

        {/* Instagram connection status */}
        <div className="sidebar-footer">
          <div className="card-session">
            <div className="conn-status">
              <div className={`conn-dot ${session ? 'online' : 'offline'}`}/>
              <span className="conn-username">{session ? session.username : 'Not connected'}</span>
            </div>
            {session
              ? <button className="btn btn-danger btn-sm w-full" style={{justifyContent:'center'}} onClick={disconnectInstagram}>Disconnect</button>
              : <button className="btn btn-primary btn-sm w-full" style={{justifyContent:'center'}} onClick={connectInstagram} disabled={connecting}>
                  {connecting ? <><Loader2 size={13} className="pulse"/> Connecting...</> : <><Instagram size={13}/> Connect Instagram</>}
                </button>
            }
          </div>
          <button className="nav-item-logout" onClick={logout}>
            <LogOut size={16}/> Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div className="main-content">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="topbar-title">
              {tab === 'dashboard' && 'Dashboard'}
              {tab === 'dm' && 'DM Bot'}
              {tab === 'comment' && 'Comment Bot'}
              {tab === 'settings' && 'Settings'}
            </div>
            <div className="topbar-subtitle">Welcome back, {user?.name}</div>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={() => user && fetchAll(user.id)}><RefreshCw size={15}/></button>
            {(tab === 'dm' || tab === 'comment') && (
              <button className="btn btn-primary" onClick={() => { setShowNewCampaign(true); setForm(f=>({...f, type: tab === 'dm' ? 'DM' : 'COMMENT'})); }}>
                <Plus size={15}/> New Campaign
              </button>
            )}
          </div>
        </div>

        <div className="page-content">

          {/* ── Dashboard Tab ─────────────────────────────────────────────── */}
          {tab === 'dashboard' && (
            <>
              <div className="stats-grid">
                {[
                  { icon:<Activity size={18}/>, color:'var(--aura-primary)', bg:'rgba(165,59,41,0.08)', value: campaigns.length, label:'Total Campaigns', badge: 'Total' },
                  { icon:<Play size={18}/>,     color:'var(--aura-secondary)', bg:'rgba(132,84,0,0.08)',  value: running,           label:'Running', badge: 'Active' },
                  { icon:<CheckCircle2 size={18}/>, color:'var(--green)', bg:'rgba(34,197,94,0.08)', value: totalDone, label:'Actions Done', badge: 'Completed' },
                  { icon:<AlertCircle size={18}/>,  color:'var(--aura-error)', bg:'var(--aura-error-container)', value: totalFailed, label:'Failed', badge: 'Issues' },
                ].map((s,i) => (
                  <div className="stat-card" key={i}>
                    <div className="stat-icon-row">
                      <div className="stat-icon" style={{background:s.bg,color:s.color}}>{s.icon}</div>
                      <span className="stat-badge" style={{background:s.bg,color:s.color}}>{s.badge}</span>
                    </div>
                    <div className="stat-value">{s.value}</div>
                    <div className="stat-label">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-header">
                  <div><div className="card-title">All Campaigns</div><div className="card-subtitle">Recent activity (Click row to view detailed status)</div></div>
                </div>
                {campaigns.length === 0
                  ? <div className="empty-state"><Clock size={40}/><h3>No campaigns yet</h3><p>Create a DM or Comment campaign to get started.</p></div>
                  : <CampaignTable campaigns={campaigns} onAction={campaignAction} onSelect={setSelectedCampaignId}/>
                }
              </div>
            </>
          )}

          {/* ── DM / Comment Tab ──────────────────────────────────────────── */}
          {(tab === 'dm' || tab === 'comment') && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">{tab === 'dm' ? 'DM' : 'Comment'} Campaigns</div>
                  <div className="card-subtitle">Click a campaign row to see comment breakdown and retry options</div>
                </div>
              </div>
              {campaigns.filter(c => c.type === (tab === 'dm' ? 'DM' : 'COMMENT')).length === 0
                ? <div className="empty-state">
                    {tab === 'dm' ? <Send size={40}/> : <MessageSquare size={40}/>}
                    <h3>No {tab === 'dm' ? 'DM' : 'Comment'} campaigns</h3>
                    <p>Click &quot;New Campaign&quot; to create one.</p>
                  </div>
                : <CampaignTable campaigns={campaigns.filter(c => c.type === (tab==='dm'?'DM':'COMMENT'))} onAction={campaignAction} onSelect={setSelectedCampaignId}/>
              }
            </div>
          )}

          {/* ── Settings Tab ──────────────────────────────────────────────── */}
          {tab === 'settings' && (
            <div style={{maxWidth:560}}>
              <div className="card">
                <div className="card-header"><div className="card-title">Default Automation Settings</div></div>
                <div className="form-group">
                  <label className="form-label">Min Delay: <b>{settings.delayMin}s</b></label>
                  <input type="range" min={3} max={60} value={settings.delayMin}
                    onChange={e => setSettings(s => ({...s, delayMin: +e.target.value}))}/>
                  <span className="form-hint">Minimum seconds between actions</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Delay: <b>{settings.delayMax}s</b></label>
                  <input type="range" min={5} max={120} value={settings.delayMax}
                    onChange={e => setSettings(s => ({...s, delayMax: +e.target.value}))}/>
                  <span className="form-hint">Maximum seconds between actions</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Hourly Limit: <b>{settings.hourlyLimit} actions/hr</b></label>
                  <input type="range" min={1} max={50} value={settings.hourlyLimit}
                    onChange={e => setSettings(s => ({...s, hourlyLimit: +e.target.value}))}/>
                  <span className="form-hint">Max actions per hour per campaign</span>
                </div>
                {session && (
                  <div className="form-group">
                    <label className="form-label">Proxy URL (optional)</label>
                    <div style={{position:'relative'}}>
                      <Globe size={14} style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)'}}/>
                      <input className="form-input" placeholder="http://user:pass@host:port"
                        style={{paddingLeft:34}}
                        defaultValue={session.proxyUrl || ''}
                        onBlur={async e => {
                          await axios.patch(`${API}/api/instagram/proxy/${session.id}`, { proxyUrl: e.target.value });
                        }}/>
                    </div>
                    <span className="form-hint">Leave blank to use your direct connection</span>
                  </div>
                )}
                <button className="btn btn-primary" onClick={saveSettings}>
                  {settingsSaved ? <><CheckCircle2 size={15}/> Saved!</> : 'Save Settings'}
                </button>
              </div>

              <div className="card" style={{marginTop:16}}>
                <div className="card-header"><div className="card-title">Account</div></div>
                <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
                  <div style={{width:40,height:40,borderRadius:'50%',background:'linear-gradient(135deg,var(--accent),var(--pink))',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:16}}>
                    {user?.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{fontWeight:600}}>{user?.name}</div>
                    <div className="text-muted text-sm">{user?.email}</div>
                  </div>
                </div>
                <button className="btn btn-danger" onClick={logout}><LogOut size={15}/> Sign Out</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── New Campaign Modal ─────────────────────────────────────────────── */}
      {showNewCampaign && (
        <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) setShowNewCampaign(false); }}>
          <div className="modal">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <div className="modal-title">New {form.type === 'DM' ? 'DM' : 'Comment'} Campaign</div>
              <button className="btn-ghost" onClick={() => setShowNewCampaign(false)}><X size={18}/></button>
            </div>
            {!session && <div className="auth-error">⚠️ Connect your Instagram account first.</div>}
            {formErr && <div className="auth-error">{formErr}</div>}
            <form onSubmit={createCampaign}>
              <div className="form-group">
                <label className="form-label">Campaign Name</label>
                <input className="form-input" placeholder="e.g. Promo Outreach May" value={form.name}
                  onChange={e => setForm(f=>({...f, name:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">{form.type === 'DM' ? 'Instagram Usernames' : 'Post URLs'} (one per line)</label>
                <textarea className="form-textarea"
                  placeholder={form.type === 'DM' ? 'username1\nusername2\nusername3' : 'https://www.instagram.com/p/ABC123/\nhttps://www.instagram.com/p/XYZ456/'}
                  value={form.targets} onChange={e => setForm(f=>({...f, targets:e.target.value}))}
                  style={{minHeight:100}}/>
                <span className="form-hint">{form.targets.split('\n').filter(Boolean).length} targets entered</span>
              </div>
              <div className="form-group">
                <label className="form-label">{form.type === 'DM' ? 'Messages' : 'Comments'} Pool (one per line — picked randomly)</label>
                <textarea className="form-textarea"
                  placeholder={form.type === 'DM' ? 'Hey! Loved your content...\nHi there! We have an exciting opportunity...' : 'Amazing post! 🔥\nLove this! ❤️\nSo inspiring! 💯'}
                  value={form.messages} onChange={e => setForm(f=>({...f, messages:e.target.value}))}
                  style={{minHeight:80}}/>
                <span className="form-hint">{form.messages.split('\n').filter(Boolean).length} message variants</span>
              </div>
              <div className="grid-2" style={{marginBottom:16}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Min Delay: {form.delayMin}s</label>
                  <input type="range" min={3} max={60} value={form.delayMin}
                    onChange={e => setForm(f=>({...f,delayMin:+e.target.value}))}/>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Max Delay: {form.delayMax}s</label>
                  <input type="range" min={5} max={120} value={form.delayMax}
                    onChange={e => setForm(f=>({...f,delayMax:+e.target.value}))}/>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Hourly Limit: {form.hourlyLimit} actions/hr</label>
                <input type="range" min={1} max={50} value={form.hourlyLimit}
                  onChange={e => setForm(f=>({...f,hourlyLimit:+e.target.value}))}/>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewCampaign(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={formLoading || !session}>
                  {formLoading ? <><Loader2 size={14} className="pulse"/> Creating...</> : <><Play size={14}/> Launch Campaign</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Campaign Details & Action Log Modal ─────────────────────────────────── */}
      {selectedCampaignId && (
        <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) setSelectedCampaignId(null); }}>
          <div className="modal" style={{ width: '720px', maxWidth: '95vw' }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div>
                <div className="modal-title" style={{ marginBottom: 4 }}>
                  Campaign: {selectedCampaign?.name || 'Loading...'}
                </div>
                <div className="text-muted text-sm flex items-center gap-2">
                  <span>Type: <span className="badge badge-purple">{selectedCampaign?.type}</span></span>
                  <span>•</span>
                  <span>Status: <StatusBadge status={selectedCampaign?.status || ''}/></span>
                </div>
              </div>
              <button className="btn-ghost" onClick={() => setSelectedCampaignId(null)}><X size={18}/></button>
            </div>

            {loadingDetails && !selectedCampaign ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                <Loader2 size={24} className="pulse" />
              </div>
            ) : (
              <div>
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
                  <div className="stat-card" style={{ padding: 12 }}>
                    <div className="stat-value" style={{ fontSize: 20 }}>{selectedCampaign?.jobs?.length || 0}</div>
                    <div className="stat-label">Total</div>
                  </div>
                  <div className="stat-card" style={{ padding: 12 }}>
                    <div className="stat-value" style={{ fontSize: 20, color: 'var(--green)' }}>
                      {selectedCampaign?.jobs?.filter(j => j.status === 'DONE').length || 0}
                    </div>
                    <div className="stat-label">Success</div>
                  </div>
                  <div className="stat-card" style={{ padding: 12 }}>
                    <div className="stat-value" style={{ fontSize: 20, color: 'var(--red)' }}>
                      {selectedCampaign?.jobs?.filter(j => j.status === 'FAILED').length || 0}
                    </div>
                    <div className="stat-label">Failed</div>
                  </div>
                  <div className="stat-card" style={{ padding: 12 }}>
                    <div className="stat-value" style={{ fontSize: 20, color: 'var(--yellow)' }}>
                      {selectedCampaign?.jobs?.filter(j => j.status === 'QUEUED' || j.status === 'RUNNING').length || 0}
                    </div>
                    <div className="stat-label">Pending</div>
                  </div>
                </div>

                <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>Action Breakdown</div>
                
                <div className="table-wrap" style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Comment/Msg</th>
                        <th>Status</th>
                        <th>Error Log / Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCampaign?.jobs?.map(job => (
                        <tr key={job.id}>
                          <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {selectedCampaign.type === 'COMMENT' ? (
                              <a href={job.interactionId} target="_blank" rel="noreferrer" className="auth-link flex items-center gap-1" title={job.interactionId}>
                                {job.interactionId} <ExternalLink size={12} />
                              </a>
                            ) : (
                              <a href={`https://www.instagram.com/${job.interactionId}`} target="_blank" rel="noreferrer" className="auth-link flex items-center gap-1" title={`https://www.instagram.com/${job.interactionId}`}>
                                @{job.interactionId} <ExternalLink size={12} />
                              </a>
                            )}
                          </td>
                          <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.message}>
                            {job.message}
                          </td>
                          <td>
                            <StatusBadge status={job.status}/>
                          </td>
                          <td style={{ fontSize: 11, color: job.status === 'FAILED' ? 'var(--red)' : 'var(--text-muted)' }}>
                            {job.errorMsg || (job.status === 'DONE' && 'Successfully executed') || 'Waiting in queue...'}
                          </td>
                        </tr>
                      ))}
                      {(!selectedCampaign?.jobs || selectedCampaign.jobs.length === 0) && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                            No actions logged.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <button className="btn btn-secondary" onClick={() => setSelectedCampaignId(null)}>Close</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Campaign Table Component ─────────────────────────────────────────────────
function CampaignTable({ campaigns, onAction, onSelect }: {
  campaigns: Campaign[];
  onAction: (id: string, action: 'pause' | 'resume' | 'cancel') => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Status</th><th>Progress</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map(c => {
            const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
            return (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(c.id)}>
                <td style={{fontWeight:600}}>{c.name}</td>
                <td onClick={e => e.stopPropagation()}>
                  <span className={`type-badge ${c.type === 'DM' ? 'dm' : 'comment'}`}>
                    {c.type === 'DM' ? <Send size={11} style={{marginRight:4}}/> : <MessageSquare size={11} style={{marginRight:4}}/>} {c.type}
                  </span>
                </td>
                <td onClick={e => e.stopPropagation()}><StatusBadge status={c.status}/></td>
                <td style={{minWidth:160}}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <div className="progress-bar-aura" style={{flex:1}}>
                      <div className="progress-fill-aura" style={{width:`${pct}%`}}/>
                    </div>
                    <span className="progress-text">{c.done}/{c.total}</span>
                  </div>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  <div style={{display:'flex',gap:6}}>
                    {c.status === 'RUNNING' && (
                      <button className="btn-action pause" onClick={() => onAction(c.id,'pause')} title="Pause"><Pause size={13}/></button>
                    )}
                    {(c.status === 'PAUSED' || c.status === 'QUEUED') && (
                      <button className="btn-action play" onClick={() => onAction(c.id,'resume')} title="Resume"><Play size={13}/></button>
                    )}
                    {c.status !== 'COMPLETED' && c.status !== 'CANCELLED' && (
                      <button className="btn-action cancel" onClick={() => onAction(c.id,'cancel')} title="Cancel"><XCircle size={13}/></button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
