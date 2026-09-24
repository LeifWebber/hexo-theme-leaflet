'use strict';

// Keep original sources intact so native loading and no-script browsing work.
// The site's image pipeline supplies dimensions, placeholders and transitions.
hexo.extend.filter.register(
  'after_post_render',
  function (data) {
    if (!hexo.theme.config.articles.lazyload) return data;
    data.content = data.content.replace(
      /<img\b[^>]*>/gi,
      function (tag) {
        return /\bloading\s*=/i.test(tag)
          ? tag
          : tag.replace(/^<img\b/i, '<img loading="lazy"');
      }
    );
    return data;
  },
  1
);
