export default function RaffleAvatar({ user }) {
  if (user?.avatar_url) {
    return <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-surface-border" />;
  }
  return (
    <div className="w-8 h-8 rounded-full bg-accent-primary/20 border border-accent-primary/30 flex items-center justify-center text-xs font-display font-bold text-accent-glow">
      {(user?.username || '?').charAt(0).toUpperCase()}
    </div>
  );
}
