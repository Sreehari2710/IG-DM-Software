'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import { Instagram, Lock, Mail, User, Eye, EyeOff, Loader2 } from 'lucide-react';

type ElectronBridge = { electron?: { getBackendPort: () => Promise<number> } };

async function resolveApiBase(): Promise<string> {
  if (typeof window !== 'undefined') {
    const w = window as unknown as ElectronBridge;
    if (w.electron?.getBackendPort) {
      try { return `http://127.0.0.1:${await w.electron.getBackendPort()}`; }
      catch { /* fallback */ }
    }
  }
  return 'http://127.0.0.1:5000';
}

export default function SignupPage() {
  const router = useRouter();
  const [apiBase, setApiBase] = useState('http://127.0.0.1:5000');
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    resolveApiBase().then(setApiBase);
    if (typeof window !== 'undefined') {
      const user = localStorage.getItem('user');
      if (user) router.push('/');
    }
  }, [router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.password) { setError('Please fill in all fields'); return; }
    if (formData.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await axios.post(`${apiBase}/api/auth/register`, formData);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      router.push('/');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Registration failed. Please try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="aura-auth-scope">
      {/* Background Decorative Blobs */}
      <div className="fixed-bg-blobs">
        <div className="blob-1"></div>
        <div className="blob-2"></div>
      </div>

      <div className="auth-layout">
        {/* Left Column: Editorial Side Panel (Mockup 2) */}
        <div className="auth-side-panel signup-panel">
          <div className="signup-side-content">
            <div className="signup-logo-header">
              <Instagram size={28} color="white" />
              <span>Vuducom DM</span>
            </div>
            
            <div className="signup-headline-section" style={{ margin: 'auto 0' }}>
              <h1 className="signup-headline-text">
                Join a community of creative minds.
              </h1>
              <p className="signup-desc-text">
                Experience an editorial social space designed for clarity, warmth, and meaningful connections.
              </p>
            </div>

            <div className="signup-side-footer">
              <div className="avatar-row" style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <div className="avatar-img" style={{ background: 'linear-gradient(135deg, #ff7e67, #a53b29)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 'bold' }}>JD</div>
                <div className="avatar-img" style={{ background: 'linear-gradient(135deg, #feb246, #845400)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 'bold' }}>AM</div>
                <div className="avatar-img" style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 'bold' }}>SK</div>
              </div>
              <span className="signup-trusted-text">
                Trusted by 2M+ creators
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Sign Up Card Panel */}
        <div className="auth-form-panel">
          <div className="auth-content-block">
            
            {/* Header/Logo Area (for Mobile View) */}
            <div className="auth-brand-center" style={{ marginBottom: -8 }}>
              <div className="brand-icon-box">
                <Instagram size={36} color="white" />
              </div>
              <h1 className="brand-title">Vuducom DM</h1>
              <p className="brand-subtitle">Instagram Automation</p>
            </div>

            {/* Signup Card */}
            <div className="auth-card-aura">
              <div className="card-header-aura">
                <h2 className="card-title-aura">Create Account</h2>
                <p className="card-subtitle-aura">Start your journey into a more intentional social space today.</p>
              </div>

              {/* Error Notice */}
              {error && (
                <div className="error-box-aura">
                  <Instagram size={16} style={{ marginRight: 4 }} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Full Name Field */}
                <div className="form-group-aura">
                  <label className="form-label-aura" htmlFor="name">Full Name</label>
                  <div className="input-relative">
                    <input 
                      name="name" 
                      id="name"
                      type="text" 
                      className="form-input-aura" 
                      placeholder="Enter your full name"
                      value={formData.name} 
                      onChange={handleChange} 
                    />
                  </div>
                </div>

                {/* Email Field */}
                <div className="form-group-aura">
                  <label className="form-label-aura" htmlFor="email">Email address</label>
                  <div className="input-relative">
                    <input 
                      name="email" 
                      id="email"
                      type="email" 
                      className="form-input-aura" 
                      placeholder="name@example.com"
                      value={formData.email} 
                      onChange={handleChange} 
                      autoComplete="email" 
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="form-group-aura">
                  <label className="form-label-aura" htmlFor="password">Password</label>
                  <div className="input-relative">
                    <input 
                      name="password" 
                      id="password"
                      type={showPass ? 'text' : 'password'} 
                      className="form-input-aura" 
                      placeholder="Min. 6 characters" 
                      value={formData.password} 
                      onChange={handleChange} 
                      autoComplete="new-password" 
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPass(!showPass)} 
                      className="eye-toggle-btn"
                      aria-label="Toggle password visibility"
                    >
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Action Button */}
                <button 
                  type="submit" 
                  className="btn-primary-aura" 
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="pulse" /> 
                      Creating account...
                    </>
                  ) : 'Create Account'}
                </button>
              </form>
            </div>

            {/* Footer Link */}
            <p className="footer-text-aura">
              Already have an account?{' '}
              <Link href="/signin" className="footer-link-aura">Sign in</Link>
            </p>

          </div>
        </div>
      </div>
    </div>
  );
}
