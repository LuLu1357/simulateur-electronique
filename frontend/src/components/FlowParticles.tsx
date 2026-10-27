import { particleDuration, flowDirection } from "../visuals";

/** Points symboliques : signe lié au courant calculé, vitesse uniquement visuelle. */
export function FlowParticles({
  path,
  current,
  mode,
  speed,
  indicative = false,
}: {
  path: string;
  current: number | null | undefined;
  mode: string;
  speed: number;
  indicative?: boolean;
}) {
  if (
    mode === "off" ||
    !path ||
    current == null ||
    !Number.isFinite(current) ||
    Math.abs(current) < 1e-9
  )
    return null;
  const backwards =
    flowDirection(
      current,
      mode === "electrons" ? "electrons" : "conventional",
    ) === "reverse";
  const seconds = particleDuration(current, speed);
  return (
    <g
      pointerEvents="none"
      className="flow-particles"
      data-flow-mode={mode}
      data-flow-direction={backwards ? "reverse" : "forward"}
      data-current={current}
      data-flow-confidence={indicative ? "indicative" : "unique"}
    >
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          r={mode === "electrons" ? 2.8 : 2.4}
          fill={mode === "electrons" ? "#d1ecff" : "#ffe1a1"}
          stroke={mode === "electrons" ? "#459cda" : "#d7a55b"}
          strokeWidth=".7"
          opacity={indicative ? 0.72 : 0.95}
        >
          <animateMotion
            path={path}
            dur={`${seconds}s`}
            begin={`${(-seconds * i) / 4}s`}
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints={backwards ? "1;0" : "0;1"}
            keyTimes="0;1"
          />
        </circle>
      ))}
    </g>
  );
}
