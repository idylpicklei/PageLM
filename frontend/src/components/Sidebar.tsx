import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { getChats } from "../lib/api";
import { useAuth } from "./AuthProvider";

interface Chat {
  id: string;
  title?: string;
}

interface ChatsResponse {
  chats: Chat[];
}

function itemClass(active: boolean) {
  return `p-2 rounded-xl duration-300 transition-all ${
    active ? "text-white bg-stone-800" : "hover:bg-stone-900 hover:text-stone-200"
  }`;
}

function IconHome() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M6.29367 4.96556C3.62685 6.90311 2.29344 7.87189 1.76974 9.30291C1.72773 9.41771 1.68994 9.534 1.65645 9.65157C1.23901 11.1171 1.74832 12.6846 2.76696 15.8197C3.78559 18.9547 4.2949 20.5222 5.49405 21.4625C5.59025 21.5379 5.68918 21.6098 5.79064 21.678C7.05546 22.5279 8.70364 22.5279 12 22.5279C15.2964 22.5279 16.9446 22.5279 18.2094 21.678C18.3108 21.6098 18.4098 21.5379 18.506 21.4625C19.7051 20.5222 20.2144 18.9547 21.2331 15.8197C22.2517 12.6846 22.761 11.1171 22.3436 9.65157C22.3101 9.534 22.2723 9.41771 22.2303 9.30291C21.7066 7.87189 20.3732 6.90312 17.7064 4.96557C15.0395 3.02801 13.7061 2.05923 12.1833 2.00336C12.0611 1.99888 11.9389 1.99888 11.8167 2.00336C10.2939 2.05923 8.96048 3.02801 6.29367 4.96556ZM10 17.0697C9.58579 17.0697 9.25 17.4054 9.25 17.8197C9.25 18.2339 9.58579 18.5697 10 18.5697H14C14.4142 18.5697 14.75 18.2339 14.75 17.8197C14.75 17.4054 14.4142 17.0697 14 17.0697H10Z" fill="currentColor" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C6.06294 1.25 1.25 6.06294 1.25 12C1.25 17.9371 6.06294 22.75 12 22.75C17.9371 22.75 22.75 17.9371 22.75 12C22.75 6.06294 17.9371 1.25 12 1.25ZM12.75 8C12.75 7.58579 12.4142 7.25 12 7.25C11.5858 7.25 11.25 7.58579 11.25 8L11.25 11.5C11.25 12.7426 12.2574 13.75 13.5 13.75H15C15.4142 13.75 15.75 13.4142 15.75 13C15.75 12.5858 15.4142 12.25 15 12.25H13.5C13.0858 12.25 12.75 11.9142 12.75 11.5L12.75 8Z" fill="currentColor" />
    </svg>
  );
}

function IconBag() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M5.24472 6.45492C5 7.20808 5 8.13872 5 10V17.3874C5 19.3045 5 20.2631 5.34196 20.77C5.75971 21.3893 6.48778 21.7242 7.22986 21.6383C7.8373 21.568 8.56509 20.9442 10.0207 19.6966C10.6614 19.1474 10.9818 18.8728 11.3337 18.7484C11.7648 18.5961 12.2352 18.5961 12.6663 18.7484C13.0182 18.8728 13.3386 19.1474 13.9793 19.6965C15.4349 20.9442 16.1627 21.568 16.7701 21.6383C17.5122 21.7242 18.2403 21.3893 18.658 20.77C19 20.2631 19 19.3045 19 17.3874V10C19 8.13872 19 7.20808 18.7553 6.45492C18.2607 4.93273 17.0673 3.73931 15.5451 3.24472C14.7919 3 13.8613 3 12 3C10.1387 3 9.20808 3 8.45492 3.24472C6.93273 3.73931 5.73931 4.93273 5.24472 6.45492ZM12 5.25C11.5858 5.25 11.25 5.58579 11.25 6C11.25 6.41421 11.5858 6.75 12 6.75C13.7949 6.75 15.25 8.20507 15.25 10C15.25 10.4142 15.5858 10.75 16 10.75C16.4142 10.75 16.75 10.4142 16.75 10C16.75 7.37665 14.6234 5.25 12 5.25Z" fill="currentColor" />
    </svg>
  );
}

function IconGroups() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM14.25 8.625a3.375 3.375 0 1 1 6.75 0 3.375 3.375 0 0 1-6.75 0ZM1.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM17.25 19.128l-.001.144a2.25 2.25 0 0 1-.233.96 10.088 10.088 0 0 0 5.06-1.01.75.75 0 0 0 .42-.643 4.875 4.875 0 0 0-6.957-4.611 8.586 8.586 0 0 1 1.71 5.157v.003Z" />
    </svg>
  );
}

const MORE_LINKS: Array<{ to: string; label: string; icon: ReactNode; match?: (path: string) => boolean }> = [
  {
    to: "/quiz",
    label: "Quiz",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .75a8.25 8.25 0 0 0-4.135 15.39c.686.398 1.115 1.008 1.134 1.623a.75.75 0 0 0 .577.706c.352.083.71.148 1.074.195.323.041.6-.218.6-.544v-4.661a6.714 6.714 0 0 1-.937-.171.75.75 0 1 1 .374-1.453 5.261 5.261 0 0 0 2.626 0 .75.75 0 1 1 .374 1.452 6.712 6.712 0 0 1-.937.172v4.66c0 .327.277.586.6.545.364-.047.722-.112 1.074-.195a.75.75 0 0 0 .577-.706c.02-.615.448-1.225 1.134-1.623A8.25 8.25 0 0 0 12 .75Z" />
      </svg>
    ),
  },
  {
    to: "/tools",
    label: "Tools",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
      </svg>
    ),
  },
  {
    to: "/exam",
    label: "Exam",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32L19.513 8.2Z" />
      </svg>
    ),
  },
  {
    to: "/planner",
    label: "Planner",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M7.5 5.25a3 3 0 0 1 3-3h3a3 3 0 0 1 3 3v.205c.933.085 1.857.197 2.774.334 1.454.218 2.476 1.483 2.476 2.917v3.033c0 1.211-.734 2.352-1.936 2.752A24.726 24.726 0 0 1 12 15.75c-2.73 0-5.357-.442-7.814-1.259-1.202-.4-1.936-1.541-1.936-2.752V8.706c0-1.434 1.022-2.7 2.476-2.917A48.814 48.814 0 0 1 7.5 5.455V5.25Zm7.5 0v.09a49.488 49.488 0 0 0-6 0v-.09a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5Zm-3 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
        <path d="M3 18.4v-2.796a4.3 4.3 0 0 0 .713.31A26.226 26.226 0 0 0 12 17.25c2.892 0 5.68-.468 8.287-1.335.252-.084.49-.189.713-.311V18.4c0 1.452-1.047 2.728-2.523 2.923-2.12.282-4.282.427-6.477.427a49.19 49.19 0 0 1-6.477-.427C4.047 21.128 3 19.852 3 18.4Z" />
      </svg>
    ),
  },
  {
    to: "/debate",
    label: "Debate",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97ZM6.75 8.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H7.5Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    to: "/canvas",
    label: "Canvas",
    icon: (
      <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const p = useLocation().pathname;
  const { user, logout } = useAuth();
  const [chatsOpen, setChatsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chats, setChats] = useState<ChatsResponse | null>(null);

  useEffect(() => {
    getChats().then((data) => setChats(data)).catch(() => setChats({ chats: [] }));
  }, [p]);

  useEffect(() => {
    setMoreOpen(false);
    setChatsOpen(false);
  }, [p]);

  const moreActive = MORE_LINKS.some((link) => p === link.to || p.startsWith(`${link.to}/`));
  const tab = (to: string, extra = false) =>
    extra || p === to || (to !== "/" && p.startsWith(to));

  return (
    <>
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-50 border-t border-stone-800 bg-stone-950/95 backdrop-blur-xl">
        <div className="grid grid-cols-5 px-1 pt-1 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
          <Link to="/" className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl ${tab("/") && p === "/" ? "text-white" : "text-stone-400"}`}>
            <IconHome />
            <span className="text-[10px]">Home</span>
          </Link>
          <Link to="/chat" className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl ${p.startsWith("/chat") ? "text-white" : "text-stone-400"}`}>
            <IconChat />
            <span className="text-[10px]">Chat</span>
          </Link>
          <Link to="/cards" className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl ${p === "/cards" || p === "/study" ? "text-white" : "text-stone-400"}`}>
            <IconBag />
            <span className="text-[10px]">Bag</span>
          </Link>
          <Link to="/groups" className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl ${p.startsWith("/groups") ? "text-white" : "text-stone-400"}`}>
            <IconGroups />
            <span className="text-[10px]">Groups</span>
          </Link>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl ${moreActive || moreOpen ? "text-white" : "text-stone-400"}`}
          >
            <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" d="M4.5 12a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm6 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm6 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px]">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/50" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-stone-800 bg-stone-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-stone-700" />
            <div className="grid grid-cols-3 gap-2 mb-4">
              {MORE_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-2 rounded-2xl border px-2 py-3 text-xs ${
                    p === link.to || p.startsWith(`${link.to}/`)
                      ? "border-zinc-700 bg-stone-800 text-white"
                      : "border-zinc-800 bg-stone-900/50 text-stone-300"
                  }`}
                >
                  {link.icon}
                  {link.label}
                </Link>
              ))}
            </div>
            {!!chats?.chats.length && (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-stone-500 mb-2">Recent chats</div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {chats.chats.slice(0, 8).map((chat) => (
                    <Link
                      key={chat.id}
                      to={`/chat/?chatId=${chat.id}`}
                      onClick={() => setMoreOpen(false)}
                      className="block rounded-xl px-3 py-2 text-sm text-stone-200 hover:bg-stone-900 truncate"
                    >
                      {chat.title || "Untitled Chat"}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
              <div className="text-xs text-stone-500 truncate">{user?.email}</div>
              <button
                type="button"
                onClick={() => void logout()}
                className="text-sm text-stone-300 hover:text-white"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className="hidden md:flex left-0 bottom-0 w-fit h-screen fixed p-4 z-50">
        <div className={`${chatsOpen ? "flex" : "hidden"} w-64 order-2 h-full z-40 rounded-l-none rounded-2xl bg-stone-950 border border-l-transparent border-stone-900 flex-col p-4 space-y-3 overflow-y-auto custom-scroll`}>
          {chats?.chats.map((chat) => (
            <Link key={chat.id} to={`/chat/?chatId=${chat.id}`} className="p-2 hover:text-stone-200 hover:bg-stone-900 w-full rounded-xl block text-sm min-h-fit truncate">
              {chat.title || "Untitled Chat"}
            </Link>
          ))}
        </div>
        <div className={`w-20 order-1 h-full rounded-3xl bg-stone-950/50 backdrop-blur-xl border border-stone-900 text-stone-400 flex flex-col items-center justify-between py-4 ${chatsOpen ? "rounded-r-none" : ""}`}>
          <img src="/logo.png" alt="logo" className="w-10 h-auto rounded-full" />
          <nav className="flex flex-col items-center space-y-2 my-auto">
            <Link to="/" className={itemClass(p === "/")} title="Home"><IconHome /></Link>
            <button type="button" onClick={() => setChatsOpen((open) => !open)} className={itemClass(chatsOpen)} title="Chats">
              <IconChat />
            </button>
            <Link to="/tools" className={itemClass(p === "/tools")} title="Tools">
              <svg className="size-6" viewBox="0 0 24 24" fill="none">
                <path d="M4.99999 11.0781V13.6264C4.99999 15.4877 4.99999 16.4184 5.24471 17.1715C5.7393 18.6937 6.93272 19.8871 8.45491 20.3817C9.20807 20.6264 10.1387 20.6264 12 20.6264C13.8613 20.6264 14.7919 20.6264 15.5451 20.3817C17.0673 19.8871 18.2607 18.6937 18.7553 17.1715C19 16.4184 19 15.4877 19 13.6264V11.0813M19 11.0813C18.0427 11.4693 16.8601 11.8907 15.4529 12.3933L13.3455 13.146C12.6795 13.3838 12.3465 13.5028 12.0001 13.5028C11.6537 13.5028 11.3207 13.3838 10.6547 13.146L8.54734 12.3933C4.14668 10.8217 1.94635 10.0358 1.94635 8.62638C1.94635 7.21695 4.14668 6.4311 8.54734 4.85942L10.6547 4.10677C11.3207 3.86892 11.6537 3.75 12.0001 3.75C12.3465 3.75 12.6795 3.86892 13.3455 4.10677L15.4529 4.85942C19.8535 6.4311 22.0539 7.21695 22.0539 8.62638C22.0539 9.58509 21.0361 10.2561 19 11.0813Z" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </Link>
            <Link to="/exam" className={itemClass(p === "/exam")} title="Exam">
              <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32L19.513 8.2Z" />
              </svg>
            </Link>
            <Link to="/quiz" className={itemClass(p === "/quiz")} title="Quiz">
              <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .75a8.25 8.25 0 0 0-4.135 15.39c.686.398 1.115 1.008 1.134 1.623a.75.75 0 0 0 .577.706c.352.083.71.148 1.074.195.323.041.6-.218.6-.544v-4.661a6.714 6.714 0 0 1-.937-.171.75.75 0 1 1 .374-1.453 5.261 5.261 0 0 0 2.626 0 .75.75 0 1 1 .374 1.452 6.712 6.712 0 0 1-.937.172v4.66c0 .327.277.586.6.545.364-.047.722-.112 1.074-.195a.75.75 0 0 0 .577-.706c.02-.615.448-1.225 1.134-1.623A8.25 8.25 0 0 0 12 .75Z" />
              </svg>
            </Link>
            <Link to="/planner" className={itemClass(p === "/planner")} title="Planner">
              <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M7.5 5.25a3 3 0 0 1 3-3h3a3 3 0 0 1 3 3v.205c.933.085 1.857.197 2.774.334 1.454.218 2.476 1.483 2.476 2.917v3.033c0 1.211-.734 2.352-1.936 2.752A24.726 24.726 0 0 1 12 15.75c-2.73 0-5.357-.442-7.814-1.259-1.202-.4-1.936-1.541-1.936-2.752V8.706c0-1.434 1.022-2.7 2.476-2.917A48.814 48.814 0 0 1 7.5 5.455V5.25Zm7.5 0v.09a49.488 49.488 0 0 0-6 0v-.09a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5Zm-3 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" clipRule="evenodd" />
                <path d="M3 18.4v-2.796a4.3 4.3 0 0 0 .713.31A26.226 26.226 0 0 0 12 17.25c2.892 0 5.68-.468 8.287-1.335.252-.084.49-.189.713-.311V18.4c0 1.452-1.047 2.728-2.523 2.923-2.12.282-4.282.427-6.477.427a49.19 49.19 0 0 1-6.477-.427C4.047 21.128 3 19.852 3 18.4Z" />
              </svg>
            </Link>
            <Link to="/debate" className={itemClass(p === "/debate")} title="Debate">
              <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97ZM6.75 8.25a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H7.5Z" clipRule="evenodd" />
              </svg>
            </Link>
            <Link to="/groups" className={itemClass(p.startsWith("/groups"))} title="Study Groups"><IconGroups /></Link>
            <Link to="/cards" className={itemClass(p === "/cards" || p === "/study")} title="Bag"><IconBag /></Link>
            <Link to="/canvas" className={itemClass(p === "/canvas")} title="Canvas">
              <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            </Link>
          </nav>
          <div className="flex flex-col items-center gap-2 w-full px-2">
            <div className="text-[10px] text-stone-500 truncate w-full text-center" title={user?.email}>
              {user?.email}
            </div>
            <button type="button" onClick={() => void logout()} className="text-xs text-stone-400 hover:text-white transition">
              Log out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
