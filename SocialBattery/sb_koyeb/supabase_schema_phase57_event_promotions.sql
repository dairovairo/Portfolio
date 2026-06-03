alter table community_events add column if not exists promotion_type text not null default 'basic';
create index if not exists idx_community_events_promotion_type on community_events(promotion_type);