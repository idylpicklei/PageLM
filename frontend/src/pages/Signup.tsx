import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authRegister } from "../lib/api";
import { useAuth } from "../components/AuthProvider";

export default function Signup() {
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
      await authRegister(email, password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
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
            <h1 className="text-xl font-semibold text-white">Create account</h1>
            <p className="text-sm text-stone-500">Your chats, planner, and cards stay private</p>
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-stone-800 bg-stone-900/80 px-4 py-3 text-white outline-none focus:border-stone-600"
            />
            <span className="text-xs text-stone-500">At least 8 characters</span>
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-white text-black font-medium py-3 hover:bg-stone-200 disabled:opacity-60 transition"
          >
            {busy ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-stone-500 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-stone-200 hover:text-white">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
