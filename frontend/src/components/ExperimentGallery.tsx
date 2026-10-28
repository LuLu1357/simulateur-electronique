import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Beaker,
  Check,
  Clock3,
  LoaderCircle,
  X,
} from "lucide-react";
import "../experiments.css";

type ExperimentCategory = "Premiers pas" | "Transistors" | "Logique";
type Experiment = {
  id: string;
  number: string;
  title: string;
  category: ExperimentCategory;
  duration: string;
  description: string;
  prediction: string;
  challenge: string;
  accent: string;
};

const experiments: Experiment[] = [
  {
    id: "ohm",
    number: "01",
    title: "Le courant prend forme",
    category: "Premiers pas",
    duration: "3 min",
    description:
      "Une source, une résistance. Observe le lien entre tension, résistance et courant.",
    prediction: "5 V ÷ 1 kΩ = 5 mA",
    challenge: "Double R1. Que devient le courant ?",
    accent: "mint",
  },
  {
    id: "divider",
    number: "02",
    title: "Partager les volts",
    category: "Premiers pas",
    duration: "5 min",
    description:
      "Deux résistances se partagent une tension. Mesure leur point de rencontre.",
    prediction: "Deux résistances égales → 2,5 V au centre",
    challenge: "Passe R2 à 2 kΩ, puis recalcule.",
    accent: "amber",
  },
  {
    id: "rc",
    number: "03",
    title: "Apprivoiser le temps",
    category: "Premiers pas",
    duration: "5 min",
    description:
      "Un condensateur se charge progressivement. Découvre la constante de temps RC.",
    prediction: "À 1 ms : environ 3,16 V, soit 63,2 %",
    challenge: "Double C1 et compare les courbes TRAN.",
    accent: "blue",
  },
  {
    id: "diode",
    number: "04",
    title: "Un sens de passage",
    category: "Premiers pas",
    duration: "4 min",
    description:
      "La diode conduit dans un sens. Sa résistance série limite le courant.",
    prediction: "En direct : conduction ; en inverse : blocage",
    challenge: "Inverse les 5 V de V1 et compare.",
    accent: "rose",
  },
  {
    id: "led",
    number: "05",
    title: "Mettre le courant en lumière",
    category: "Premiers pas",
    duration: "5 min",
    description:
      "Une DEL rouge, 5 V et une résistance de 330 Ω. Observe comment limiter son courant.",
    prediction: "Avec le modèle rouge : environ 9,3 mA",
    challenge: "Passe R1 à 680 Ω, puis change le modèle de LED1.",
    accent: "rose",
  },
  {
    id: "potentiometer",
    number: "06",
    title: "Tourner pour explorer",
    category: "Premiers pas",
    duration: "4 min",
    description:
      "Une piste de 10 kΩ et un curseur mobile permettent de régler une tension entre 0 et 5 V.",
    prediction: "Curseur à 50 %, sans charge : 2,5 V",
    challenge: "Déplace le curseur de RV1 et mesure P1.",
    accent: "blue",
  },
  {
    id: "pulse_rc",
    number: "07",
    title: "Donner un rythme au circuit",
    category: "Premiers pas",
    duration: "7 min",
    description:
      "Des créneaux de 0 à 5 V font charger puis décharger un condensateur. Compare le signal d’entrée à la réponse RC.",
    prediction: "τ = 1 ms · période = 6 ms · trois cycles",
    challenge:
      "Change la période de V1 et observe le filtrage dans l’oscilloscope.",
    accent: "amber",
  },
  {
    id: "npn",
    number: "08",
    title: "Commander avec peu",
    category: "Transistors",
    duration: "6 min",
    description:
      "Un courant de base pilote le collecteur d’un transistor NPN générique.",
    prediction: "Base commandée : le collecteur descend",
    challenge: "Passe Vin de 5 V à 0 V et mesure Q1.",
    accent: "mint",
  },
  {
    id: "pnp",
    number: "09",
    title: "Changer de perspective",
    category: "Transistors",
    duration: "6 min",
    description:
      "Explore la commande d’un PNP, avec son émetteur relié au positif.",
    prediction: "Base abaissée : le collecteur est alimenté",
    challenge: "Passe Vin de 0 V à 5 V et compare.",
    accent: "violet",
  },
  {
    id: "two_boards",
    number: "10",
    title: "Relier deux îlots",
    category: "Premiers pas",
    duration: "7 min",
    description:
      "Un pont diviseur réparti sur deux plaques. Les bandes et rails restent indépendants, les cavaliers relient le montage.",
    prediction: "Deux résistances égales → 2,5 V en sortie",
    challenge:
      "Repère les liaisons entre plaques et retrouve R2 sur la deuxième.",
    accent: "mint",
  },
  {
    id: "subtractor",
    number: "11",
    title: "Faire compter les transistors",
    category: "Logique",
    duration: "10 min",
    description:
      "Vingt portes NAND à transistors forment un soustracteur à deux bits.",
    prediction: "0 − 1 → 11 (modulo 4), emprunt = 1",
    challenge: "Teste les 16 cas dans la table de vérité.",
    accent: "amber",
  },
  {
    id: "rlc",
    number: "12",
    title: "Faire circuler l’énergie",
    category: "Premiers pas",
    duration: "8 min",
    description:
      "Une bobine de 10 mH et un condensateur de 1 µF échangent de l’énergie après chaque front de tension. La résistance freine leurs oscillations.",
    prediction: "Faible résistance : dépassement puis oscillations amorties",
    challenge: "Passe R1 de 30 Ω à 200 Ω et compare les réponses temporelles.",
    accent: "amber",
  },
];

function ExperimentDrawing({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 280 92" fill="none" aria-hidden="true" focusable="false">
      <path
        className="experiment-drawing-grid"
        d="M0 23H280M0 46H280M0 69H280M35 0V92M70 0V92M105 0V92M140 0V92M175 0V92M210 0V92M245 0V92"
      />
      <g
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {id === "ohm" && (
          <>
            <path d="M52 34H107M173 34H228V73H52V53" />
            <rect x="107" y="25" width="66" height="18" rx="2" />
            <circle cx="52" cy="43" r="10" />
            <path d="M48 43H56M52 39V47M197 34L190 30M197 34L190 38" />
            <text x="140" y="65" textAnchor="middle">
              I = U / R
            </text>
          </>
        )}
        {id === "divider" && (
          <>
            <path d="M37 46H76M120 46H160M204 46H244M140 46V69H199" />
            <rect x="76" y="37" width="44" height="18" rx="2" />
            <rect x="160" y="37" width="44" height="18" rx="2" />
            <circle cx="140" cy="46" r="3" fill="currentColor" />
            <text x="37" y="31">
              5 V
            </text>
            <text x="225" y="31">
              0 V
            </text>
            <text x="204" y="73">
              2,5 V
            </text>
          </>
        )}
        {id === "led" && (
          <>
            <path d="M35 50H71M111 50H137M176 50H244M176 33V67M137 33L166 50L137 67Z" />
            <rect x="71" y="42" width="40" height="16" rx="2" />
            <path d="M177 28L194 11M188 12H194V18M189 36L208 17M202 18H208V24" />
            <text x="78" y="30">
              330 Ω
            </text>
            <text x="137" y="83">
              DEL rouge
            </text>
          </>
        )}
        {id === "potentiometer" && (
          <>
            <path d="M35 35H94M186 35H244M140 82V47M135 53L140 47L145 53" />
            <rect x="94" y="26" width="92" height="18" rx="2" />
            <path
              className="experiment-drawing-guide"
              d="M103 69H128M152 69H177"
            />
            <path d="M107 65L103 69L107 73M173 65L177 69L173 73" />
            <text x="35" y="21">
              5 V
            </text>
            <text x="224" y="21">
              0 V
            </text>
            <text x="159" y="85">
              2,5 V
            </text>
          </>
        )}
        {id === "two_boards" && (
          <>
            <rect x="27" y="22" width="82" height="50" rx="5" />
            <rect x="169" y="22" width="82" height="50" rx="5" />
            <path d="M40 35H95M40 59H95M181 35H237M181 59H237" opacity=".4" />
            <path d="M80 35V12H198V35M94 59V82H181V59" />
            <text x="65" y="51" textAnchor="middle">
              01
            </text>
            <text x="211" y="51" textAnchor="middle">
              02
            </text>
          </>
        )}
        {id === "pulse_rc" && (
          <>
            <path className="experiment-drawing-axis" d="M25 12V77H255" />
            <path d="M26 70H48V25H90V70H132V25H174V70H216V25H254" />
            <path
              d="M26 70H48C58 43 69 32 90 29C103 54 113 65 132 66C145 40 155 30 174 29C187 54 196 65 216 66C229 40 239 30 254 29"
              stroke="#a8e7bb"
              strokeWidth="2"
            />
            <text x="197" y="89">
              U entrée / U RC
            </text>
          </>
        )}
        {id === "rlc" && (
          <>
            <path className="experiment-drawing-axis" d="M25 12V77H255" />
            <path className="experiment-drawing-guide" d="M26 49H254" />
            <path
              d="M26 73H43C53 73 55 15 72 15S93 66 111 66S132 37 148 37S168 57 185 57S205 45 221 45S240 51 254 49"
              strokeWidth="2.3"
            />
            <text x="159" y="89">
              R · L · C
            </text>
          </>
        )}
        {id === "rc" && (
          <>
            <path
              className="experiment-drawing-axis"
              d="M32 16V76H249M32 23H249"
            />
            <path
              d="M32 75C46 42 60 29 86 25S160 23 249 23"
              strokeWidth="2.4"
            />
            <path className="experiment-drawing-guide" d="M66 76V43H32" />
            <circle cx="66" cy="43" r="3" fill="currentColor" />
            <text x="69" y="62">
              τ
            </text>
            <text x="214" y="67">
              temps →
            </text>
          </>
        )}
        {id === "diode" && (
          <>
            <path d="M38 46H113M163 46H244M163 26V66M113 26L153 46L113 66Z" />
            <path d="M74 19H97L91 14M97 19L91 24" />
            <text x="88" y="77">
              A
            </text>
            <text x="178" y="77">
              K
            </text>
          </>
        )}
        {(id === "npn" || id === "pnp") && (
          <>
            <circle cx="144" cy="46" r="29" />
            <path d="M46 46H132M132 27V65M132 36L170 14V8M132 56L170 78V84" />
            <path
              d={
                id === "npn" ? "M151 73L165 75L160 62" : "M139 61L141 72L151 65"
              }
            />
            <text x="72" y="33">
              B
            </text>
            <text x="185" y="20">
              C
            </text>
            <text x="185" y="81">
              E
            </text>
            <text x="221" y="50">
              {id.toUpperCase()}
            </text>
          </>
        )}
        {id === "subtractor" && (
          <>
            <path d="M34 31H100M34 61H100M178 46H240" />
            <path d="M100 22H134C174 22 174 70 134 70H100Z" />
            <circle cx="172" cy="46" r="5" />
            <text x="35" y="20">
              A
            </text>
            <text x="35" y="81">
              B
            </text>
            <text x="210" y="31">
              A − B
            </text>
            <path
              className="experiment-drawing-guide"
              d="M65 31V61M213 46V76H245"
            />
          </>
        )}
      </g>
    </svg>
  );
}

export type ExperimentGalleryProps = {
  open: boolean;
  onClose: () => void;
  onLoad: (id: string) => Promise<void>;
  availableIds: string[];
  busy: boolean;
};

export function ExperimentGallery({
  open,
  onClose,
  onLoad,
  availableIds,
  busy,
}: ExperimentGalleryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadingRef = useRef(false);
  const [filter, setFilter] = useState("Tous");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    setError("");
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  const available = experiments.filter((item) =>
    availableIds.includes(item.id),
  );
  const visible = available.filter(
    (item) => filter === "Tous" || item.category === filter,
  );
  const load = async (id: string) => {
    if (busy || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(id);
    setError("");
    try {
      await onLoad(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loadingRef.current = false;
      setLoading(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="experiment-gallery"
      aria-labelledby="experiment-gallery-title"
      aria-describedby="experiment-gallery-description"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (!loadingRef.current) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!loadingRef.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !loadingRef.current)
          onClose();
      }}
    >
      <div className="experiment-gallery-inner">
        <header className="experiment-gallery-header">
          <div>
            <span className="experiment-gallery-eyebrow">
              <Beaker size={14} /> LE LABO DES POSSIBLES
            </span>
            <h2 id="experiment-gallery-title">
              À toi d’expérimenter<span>.</span>
            </h2>
            <p id="experiment-gallery-description">
              Pars d’un circuit, fais une prédiction, puis laisse les mesures te
              répondre.
            </p>
          </div>
          <button
            className="experiment-close"
            aria-label="Fermer les expériences"
            onClick={onClose}
            disabled={loading !== null}
          >
            <X size={20} />
          </button>
        </header>
        <div
          className="experiment-gallery-filters"
          role="group"
          aria-label="Filtrer les expériences"
        >
          {["Tous", "Premiers pas", "Transistors", "Logique"].map(
            (category) => (
              <button
                key={category}
                onClick={() => setFilter(category)}
                aria-pressed={filter === category}
              >
                {category}
                {category === "Tous" && <span>{available.length}</span>}
              </button>
            ),
          )}
          <span className="experiment-gallery-filter-note">
            Prédire · Mesurer · Comprendre
          </span>
        </div>
        {error && (
          <p className="experiment-gallery-error" role="alert">
            Le circuit n’a pas pu être chargé : {error}
          </p>
        )}
        {busy && (
          <p className="experiment-gallery-notice" role="status">
            Un calcul est en cours. Attends sa fin pour charger une expérience.
          </p>
        )}
        <div className="experiment-gallery-grid">
          {visible.map((item) => (
            <article
              className={`experiment-card experiment-accent-${item.accent}`}
              key={item.id}
            >
              <div className="experiment-card-art">
                <span className="experiment-number">EXP. {item.number}</span>
                <ExperimentDrawing id={item.id} />
              </div>
              <div className="experiment-card-content">
                <div className="experiment-card-meta">
                  <span>{item.category}</span>
                  <span>
                    <Clock3 size={11} /> ≈ {item.duration}
                  </span>
                </div>
                <h3>{item.title}</h3>
                <p className="experiment-card-description">
                  {item.description}
                </p>
                <div className="experiment-prediction">
                  <span>PRÉDICTION THÉORIQUE</span>
                  <p>{item.prediction}</p>
                </div>
                <p className="experiment-challenge">
                  <Check size={13} />
                  <span>{item.challenge}</span>
                </p>
                <button
                  className="experiment-load"
                  disabled={busy || loading !== null}
                  onClick={() => {
                    void load(item.id);
                  }}
                >
                  {loading === item.id ? (
                    <>
                      <LoaderCircle size={15} className="experiment-loading" />{" "}
                      Chargement…
                    </>
                  ) : (
                    <>
                      Ouvrir l’expérience <ArrowUpRight size={15} />
                    </>
                  )}
                </button>
              </div>
            </article>
          ))}
        </div>
        {visible.length === 0 && (
          <p className="experiment-gallery-empty">
            Aucune expérience disponible dans cette catégorie pour le moment.
          </p>
        )}
        <footer className="experiment-gallery-footer">
          <Beaker size={15} />
          <p>
            Charger une expérience remplace le circuit actif. Le bouton{" "}
            <strong>Annuler</strong> de l’atelier permet de le retrouver.
          </p>
        </footer>
      </div>
    </dialog>
  );
}
