type ProjectMarkProps = {
  project: string;
  className?: string;
};

function DefaultProjectMark({ project, className = '' }: ProjectMarkProps) {
  return (
    <svg className={`project-mark project-mark-unknown ${className}`.trim()} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="currentColor" opacity="0.12" />
      <text x="24" y="28" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="800">{project.slice(0, 1)}</text>
    </svg>
  );
}

export function ProjectMark({ project, className = '' }: ProjectMarkProps) {
  const sourceByProject: Record<string, string> = {
    ROWING: '/assets/olympic-sports/rowing.gif',
    CANOE_SPRINT: '/assets/olympic-sports/canoe sprint.gif',
    CANOE_SLALOM: '/assets/olympic-sports/canoe slalom.gif',
    SWIMMING: '/assets/olympic-sports/swimming.gif',
    MARATHON_SWIMMING: '/assets/olympic-sports/marathon swimming.gif',
    ARTISTIC_SWIMMING: '/assets/olympic-sports/artistic swimming.gif',
    DIVING: '/assets/olympic-sports/diving.gif',
    WATER_POLO: '/assets/olympic-sports/water polo.gif',
    SAILING: '/assets/olympic-sports/sailing.gif',
    SURFING: '/assets/olympic-sports/surfing.gif',
    ARCHERY: '/assets/olympic-sports/archery.gif',
    ATHLETICS: '/assets/olympic-sports/athletics.gif',
    BADMINTON: '/assets/olympic-sports/badminton.gif',
    BASEBALL: '/assets/olympic-sports/baseball.gif',
    SOFTBALL: '/assets/olympic-sports/softball.gif',
    BASKETBALL: '/assets/olympic-sports/basketball.gif',
    BASKETBALL_3X3: '/assets/olympic-sports/3x3 basketball.gif',
    BOXING: '/assets/olympic-sports/boxing.gif',
    FENCING: '/assets/olympic-sports/fencing.gif',
    FOOTBALL: '/assets/olympic-sports/football.gif',
    CYCLING_ROAD: '/assets/olympic-sports/cycling road.gif',
    CYCLING_TRACK: '/assets/olympic-sports/cycling track.gif',
    CYCLING_MOUNTAIN_BIKE: '/assets/olympic-sports/cycling mountain bike.gif',
    BMX_RACING: '/assets/olympic-sports/cycling BMX racing.gif',
    BMX_FREESTYLE: '/assets/olympic-sports/cycling BMX freestyle.gif',
    EQUESTRIAN_DRESSAGE: '/assets/olympic-sports/equestrian dressage.gif',
    EQUESTRIAN_EVENTING: '/assets/olympic-sports/equestrian eventing.gif',
    EQUESTRIAN_JUMPING: '/assets/olympic-sports/equestrian jumping.gif',
    ARTISTIC_GYMNASTICS: '/assets/olympic-sports/artistic gymnastics.gif',
    RHYTHMIC_GYMNASTICS: '/assets/olympic-sports/rhythmic gymnastics.gif',
    TRAMPOLINE: '/assets/olympic-sports/trampoline gymnastics.gif',
    HANDBALL: '/assets/olympic-sports/handball.gif',
    JUDO: '/assets/olympic-sports/judo.gif',
    KARATE_KATA: '/assets/olympic-sports/karate kata.gif',
    KARATE_KUMITE: '/assets/olympic-sports/karate kumite.gif',
    TABLE_TENNIS: '/assets/olympic-sports/table tennis.gif',
    TAEKWONDO: '/assets/olympic-sports/taekwondo.gif',
    TENNIS: '/assets/olympic-sports/tennis.gif',
    VOLLEYBALL: '/assets/olympic-sports/volleyball.gif',
    WEIGHTLIFTING: '/assets/olympic-sports/weightlifting.gif',
    WRESTLING: '/assets/olympic-sports/wrestling.gif',
    GOLF: '/assets/olympic-sports/golf.gif',
    HOCKEY: '/assets/olympic-sports/hockey.gif',
    SKATEBOARDING: '/assets/olympic-sports/skateboarding.gif',
    SPORT_CLIMBING: '/assets/olympic-sports/sport climbing.gif',
    TRIATHLON: '/assets/olympic-sports/triathlon.gif',
    MODERN_PENTATHLON: '/assets/olympic-sports/modern pentathlon.gif',
    RUGBY_SEVENS: '/assets/olympic-sports/rugby.gif',
    SHOOTING: '/assets/olympic-sports/shooting.gif',
    BEACH_VOLLEYBALL: '/assets/olympic-sports/beach volleyball.gif',
  };
  const source = sourceByProject[project];

  if (source) {
    return (
      <span className={`project-mark ${className}`.trim()}>
        <img
          src={source}
          alt=""
          aria-hidden="true"
        />
      </span>
    );
  } 
  return <DefaultProjectMark project={project} className={className} />;
}
