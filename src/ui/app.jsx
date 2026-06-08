// app.jsx — shell: brand + theme on top; headline metrics route to the subsection nav below.
const { useEffect, useRef, useState } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "density": "regular",
  "accent": "#5b6b97",
  "baseline": true
}/*EDITMODE-END*/;

const ACCENTS = ["#5b6b97", "#6b7a72", "#8a7a6b", "#7a6b8a", "#4f4f55"];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [section, setSection] = useState(() => localStorage.getItem("ait_section") || "friction");
  const detailRef = useRef(null);

  useEffect(() => { localStorage.setItem("ait_section", section); }, [section]);

  useEffect(() => {
    const r = document.documentElement;
    r.setAttribute("data-theme", t.dark ? "dark" : "light");
    r.setAttribute("data-density", t.density);
    r.style.setProperty("--accent", t.accent);
    document.body.classList.toggle("no-axis", !t.baseline);
  }, [t.dark, t.density, t.accent, t.baseline]);

  const goTo = (s) => {
    setSection(s);
    requestAnimationFrame(() => {
      const el = detailRef.current;
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 72;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    });
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="dot" />
            Telemetry
            <span className="sub">/ ai-ops</span>
          </div>
          <span className="spacer" />
          <button className="ghost-btn" onClick={() => setTweak("dark", !t.dark)}>
            {t.dark ? "◑ dark" : "◐ light"}
          </button>
        </div>
      </header>

      <main>
        <div className="page wrap">
          <Hero />
          <HeadlineMetrics onPick={goTo} />
          <div ref={detailRef} className="detail">
            <SubNav active={section} onChange={setSection} />
            <SectionDetail id={section} />
          </div>
        </div>
      </main>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakColor label="Accent line" value={t.accent} options={ACCENTS}
          onChange={(v) => setTweak("accent", v)} />
        <TweakSection label="Charts" />
        <TweakToggle label="Baseline axis" value={t.baseline} onChange={(v) => setTweak("baseline", v)} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
