export default defineAppConfig({
  pages: [
    "pages/home/index",
    "pages/create/index",
    "pages/room/index",
    "pages/availability/index",
    "pages/constraints/index",
    "pages/swipe/index",
    "pages/discovery/index",
    "pages/result/index",
  ],
  requiredPrivateInfos: ["getLocation"],
  permission: {
    "scope.userLocation": {
      desc: "用于根据你的出发地估算通勤时间并推荐合适地点",
    },
  },
  window: {
    navigationBarBackgroundColor: "#F7F5FF",
    navigationBarTextStyle: "black",
    navigationBarTitleText: "Couju",
    backgroundColor: "#F7F5FF",
  },
});
