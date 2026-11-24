// FormData para POST /community/communities/:id/raffles. Lo usan el modal de
// crear sorteo (Volt y Community) y la pantalla de publicidad (Light).
//
// Los premios van como JSON y sus fotos como `prize_image` repetidos, casados
// por `image_index`.
export function buildRaffleFormData(draft) {
  const formData = new FormData();
  const set = (key, value) => {
    if (value !== undefined && value !== null && value !== '') formData.append(key, String(value));
  };
  set('title', draft.title);
  set('description', draft.description?.trim());
  set('ends_at', draft.ends_at);
  set('tier', draft.tier);
  set('organizer_name', draft.organizer_name);
  set('organizer_contact', draft.organizer_contact);
  set('organizer_accepts', Boolean(draft.organizer_accepts));
  set('goal_cents', draft.goal_cents);
  set('banner_views_contracted', draft.banner_views_contracted);
  set('banner_interested_only', draft.banner_interested_only);
  if (draft.categories?.length) formData.append('categories', JSON.stringify(draft.categories));
  if (draft.image_file) formData.append('image', draft.image_file);

  let fileIndex = 0;
  const prizes = (draft.prizes || []).map(prize => {
    const entry = {
      title: prize.title,
      value_cents: prize.value_cents,
      requires_goal: Boolean(prize.requires_goal),
      has_image: Boolean(prize.image_file),
    };
    if (prize.image_file) {
      formData.append('prize_image', prize.image_file);
      entry.image_index = fileIndex;
      fileIndex += 1;
    }
    return entry;
  });
  formData.append('prizes', JSON.stringify(prizes));
  return formData;
}
