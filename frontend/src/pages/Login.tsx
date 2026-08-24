import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authLogin } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

export default function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await authLogin(email, password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-stone-300 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-stone-900 bg-stone-950/70 backdrop-blur-xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.png" alt="PageLM" className="w-10 h-10 rounded-full" />
          <div>
            <h1 className="text-xl font-semibold text-white">Sign in</h1>
            <p className="text-sm text-stone-500">Access your private workspace</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm text-stone-400">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-stone-800 bg-stone-900/80 px-4 py-3 text-white outline-none focus:border-stone-600"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm text-stone-400">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-stone-800 bg-stone-900/80 px-4 py-3 text-white outline-none focus:border-stone-600"
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-white text-black font-medium py-3 hover:bg-stone-200 disabled:opacity-60 transition"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-stone-500 text-center">
          No account?{" "}
          <Link to="/signup" className="text-stone-200 hover:text-white">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
