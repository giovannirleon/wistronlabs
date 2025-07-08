import { Link, useLocation } from "react-router-dom";

function Header() {
    const { pathname } = useLocation();

    const linkBase =
        "text-slate-300 text-sm font-medium border border-white/20 px-3 py-1 rounded hover:bg-white/10 hover:text-white";
    const active =
        "bg-white/20 text-white";

    return (
        <header className="bg-blue-900 text-white px-6 py-2 flex items-center h-[60px]">
            {/* Left side: logo, title, nav */}
            <div className="flex items-center flex-1 gap-4">
                <img src="wistron_logo.svg" alt="Logo" className="h-[30px]" />
                <h1 className="text-[1.8rem] font-medium pt-1">TSS Dashboard</h1>

                <nav className="flex gap-2 ml-4">
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
                </nav>
            </div>

            {/* Right side: need help */}
            <a
                href="https://github.com/giovannirleon/wistronlabs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 text-sm font-medium border border-white/20 px-3 py-1 rounded hover:bg-white/10 hover:text-white"
            >
                Need help?
            </a>
        </header>
    );
}

export default Header;
