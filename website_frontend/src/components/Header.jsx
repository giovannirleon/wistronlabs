import { useState, useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import { Link, useLocation } from "react-router-dom";

function Header() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const { token } = useContext(AuthContext);

  const linkBase =
    "text-slate-300 text-base md:text-sm font-medium border border-white/20 px-4 py-2 md:px-3 md:py-1 rounded hover:bg-white/10 hover:text-white";
  const active = "bg-white/20 text-white";

  return (
    <header className="sticky top-0 z-10 bg-blue-900 text-white px-4 py-2 flex items-center justify-between h-[60px]">
      {/* Left: logo + title */}
      <div className="flex items-center gap-2">
        <img
          src="wistron_logo.svg"
          alt="Logo"
          className="h-[25px] md:h-[30px]"
        />
        <h1 className="text-[1.5rem] md:text-[1.8rem] font-medium pt-1">
          TSS Dashboard
        </h1>
      </div>

      {/* Right: desktop nav + help */}
      <div className="hidden md:flex items-center gap-2">
        <Link
          to="/"
          className={`${linkBase} ${pathname === "/" ? active : ""}`}
        >
          Home
        </Link>
        <Link
          to="/tracking"
          className={`${linkBase} ${pathname === "/tracking" ? active : ""}`}
        >
          Tracking
        </Link>
        {token ? (
          <Link
            to="/user"
            className={`${linkBase} ${pathname === "/user" ? active : ""}`}
          >
            Account
          </Link>
        ) : (
          <Link
            to="/auth"
            className={`${linkBase} ${pathname === "/auth" ? active : ""}`}
          >
            Log In
          </Link>
        )}
        <a
          href="https://github.com/giovannirleon/wistronlabs"
          target="_blank"
          rel="noopener noreferrer"
          className={linkBase}
        >
          Need help?
        </a>
      </div>

      {/* Hamburger toggle */}
      <button
        onClick={() => setMenuOpen((prev) => !prev)}
        className="md:hidden text-white hover:text-slate-300 text-3xl"
      >
        ☰
      </button>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="absolute top-full left-0 w-full bg-blue-900 flex flex-col gap-2 px-4 py-3 shadow-md md:hidden">
          <Link
            to="/"
            className={`${linkBase} ${pathname === "/" ? active : ""}`}
            onClick={() => setMenuOpen(false)}
          >
            Home
          </Link>
          <Link
            to="/tracking"
            className={`${linkBase} ${pathname === "/tracking" ? active : ""}`}
            onClick={() => setMenuOpen(false)}
          >
            Tracking
          </Link>
          {token ? (
            <Link
              to="/user"
              className={`${linkBase} ${pathname === "/user" ? active : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              Account
            </Link>
          ) : (
            <Link
              to="/auth"
              className={`${linkBase} ${pathname === "/auth" ? active : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              Log In
            </Link>
          )}
          <a
            href="https://github.com/giovannirleon/wistronlabs"
            target="_blank"
            rel="noopener noreferrer"
            className={linkBase}
            onClick={() => setMenuOpen(false)}
          >
            Need help?
          </a>
        </div>
      )}
    </header>
  );
}

export default Header;
