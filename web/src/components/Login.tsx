import { useState } from 'react';
import { apiFetch } from '../api';

type Props = { onSuccess: () => void };

/** 登录 / 注册页：未登录时全站入口 */
const Login = ({ onSuccess }: Props) => {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (mode === 'register' && password !== confirm) {
            setError('两次输入的密码不一致');
            return;
        }
        setBusy(true);
        try {
            const res = await apiFetch(`/api/auth/${mode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) {
                setError(data.error ?? '操作失败，请稍后再试');
                return;
            }
            onSuccess(); // Cookie 已由服务端写入
        } catch {
            setError('网络异常，请稍后再试');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="auth-wrap">
            <div className="auth-card">
                <h2 className="auth-title">{mode === 'login' ? '登录' : '注册'}</h2>
                <p className="auth-sub">
                    {mode === 'login' ? '已有账号？输入凭据继续' : '创建账号，书签与知识库相互独立'}
                </p>
                <form className="auth-form" onSubmit={submit}>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="用户名"
                        autoComplete="username"
                        required
                        minLength={2}
                        maxLength={32}
                    />
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="密码"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        required
                        minLength={6}
                    />
                    {mode === 'register' && (
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="确认密码"
                            autoComplete="new-password"
                            required
                            minLength={6}
                        />
                    )}
                    {error && <div className="kb-error">{error}</div>}
                    <button type="submit" className="auth-submit" disabled={busy}>
                        {busy ? '请稍候…' : mode === 'login' ? '登 录' : '注 册'}
                    </button>
                    {mode === 'register' && (
                        <p className="auth-hint">密码至少 8 位，需包含字母和数字</p>
                    )}
                </form>
                <button
                    type="button"
                    className="auth-switch"
                    onClick={() => {
                        setMode(mode === 'login' ? 'register' : 'login');
                        setError('');
                    }}
                >
                    {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
                </button>
            </div>
        </div>
    );
};

export default Login;
