import LeavesImages from "../utils/image-loading.js";

export default function initLazyLoad(root = document) {
  LeavesImages.init(root);
}
