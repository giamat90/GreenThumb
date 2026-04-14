import React, { useState, useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Share,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Heart, MessageCircle, Plus, Share2, Users } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { commentCountUpdates } from "@/lib/communityUpdates";
import { ResponsiveContainer } from "@/components/ui/ResponsiveContainer";
import { useResponsive } from "@/hooks/useResponsive";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import { useProGate } from "@/hooks/useProGate";
import { UpgradeModal } from "@/components/ui/UpgradeModal";
import type { CommunityPost } from "@/types";

const PAGE_SIZE = 20;

function timeAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return t("community.justNow");
  if (mins < 60) return t("community.ago", { n: mins, unit: "m" });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("community.ago", { n: hours, unit: "h" });
  const days = Math.floor(hours / 24);
  return t("community.ago", { n: days, unit: "d" });
}

function UserAvatar({ username, avatarUrl, size = 36 }: { username?: string; avatarUrl?: string | null; size?: number }) {
  const initials = username ? username.slice(0, 2).toUpperCase() : "?";
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
  onShare,
  onProfile,
}: {
  post: CommunityPost;
  currentUserId: string;
  onLike: (postId: string, isLiked: boolean) => void;
  onComment: (postId: string) => void;
  onShare: (postId: string) => void;
  onProfile: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const caption = post.caption ?? "";
  const isLong = caption.length > 120;
  const displayCaption = !isLong || expanded ? caption : caption.slice(0, 120) + "…";

  return (
    <View style={styles.postCard}>
      {/* Header */}
      <TouchableOpacity
        style={styles.postHeader}
        onPress={() => onProfile(post.user_id)}
        activeOpacity={0.7}
      >
        <UserAvatar username={post.username} avatarUrl={post.avatar_url} />
        <View style={styles.postHeaderInfo}>
          <Text style={styles.postUsername}>{post.username ?? t("community.postedBy")}</Text>
          {post.plant_name && (
            <Text style={styles.plantTag}>{t("community.plantTag", { name: post.plant_name })}</Text>
          )}
        </View>
        <Text style={styles.postTime}>{timeAgo(post.created_at, t)}</Text>
      </TouchableOpacity>

      {/* Photo */}
      <Image
        source={{ uri: post.photo_url }}
        style={styles.postPhoto}
        resizeMode="cover"
      />

      {/* Actions */}
      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onLike(post.id, !!post.is_liked)}
          activeOpacity={0.7}
        >
          <Heart
            size={22}
            color={post.is_liked ? COLORS.danger : COLORS.textSecondary}
            fill={post.is_liked ? COLORS.danger : "transparent"}
          />
          <Text style={[styles.actionCount, post.is_liked && styles.actionCountLiked]}>
            {post.likes_count}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onComment(post.id)}
          activeOpacity={0.7}
        >
          <MessageCircle size={22} color={COLORS.textSecondary} />
          <Text style={styles.actionCount}>{post.comments_count}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => onShare(post.id)}
          activeOpacity={0.7}
        >
          <Share2 size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Caption */}
      {caption.length > 0 && (
        <View style={styles.captionContainer}>
          <Text style={styles.captionText}>
            {displayCaption}
            {isLong && !expanded && (
              <Text style={styles.expandText} onPress={() => setExpanded(true)}>
                {" "}{t("community.tapToExpand")}
              </Text>
            )}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Shared query helper ──────────────────────────────────────────────────────

async function fetchFeedRows(
  userId: string,
  offset: number,
  filterUserIds?: string[]
): Promise<{ rows: Record<string, unknown>[]; error: unknown }> {
  let query = supabase
    .from("posts")
    .select("*")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (filterUserIds !== undefined) {
    if (filterUserIds.length === 0) return { rows: [], error: null };
    query = query.in("user_id", filterUserIds);
  }

  const { data, error } = await query;
  if (error) return { rows: [], error };
  return { rows: data ?? [], error: null };
}

async function enrichRows(
  rows: Record<string, unknown>[],
  userId: string
): Promise<CommunityPost[]> {
  if (rows.length === 0) return [];

  const { data: likedData } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("user_id", userId);
  const likedIds = new Set((likedData ?? []).map((l: { post_id: string }) => l.post_id));

  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const profileMap: Record<string, Record<string, unknown>> = {};
  if (userIds.length > 0) {
    const { data: profilesData } = await supabase
      .from("user_profiles")
      .select("id, username, avatar_url")
      .in("id", userIds);
    for (const up of profilesData ?? []) {
      profileMap[(up as Record<string, unknown>).id as string] = up as Record<string, unknown>;
    }
  }

  const plantIds = [
    ...new Set(rows.map((r) => r.plant_id as string | null).filter(Boolean) as string[]),
  ];
  const plantMap: Record<string, string> = {};
  if (plantIds.length > 0) {
    const { data: plantsData } = await supabase
      .from("plants")
      .select("id, name")
      .in("id", plantIds);
    for (const pl of plantsData ?? []) {
      const p = pl as Record<string, unknown>;
      plantMap[p.id as string] = p.name as string;
    }
  }

  return rows.map((row) => {
    const up = profileMap[row.user_id as string] ?? null;
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      plant_id: row.plant_id as string | null,
      photo_url: row.photo_url as string,
      caption: row.caption as string | null,
      likes_count: row.likes_count as number,
      comments_count: row.comments_count as number,
      is_public: row.is_public as boolean,
      created_at: row.created_at as string,
      username: up?.username as string | undefined,
      avatar_url: up?.avatar_url as string | null | undefined,
      plant_name: row.plant_id ? (plantMap[row.plant_id as string] ?? null) : null,
      is_liked: likedIds.has(row.id as string),
    };
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CommunityScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useUserStore();
  const { requirePro, upgradeModalVisible, lockedFeatureName, closeUpgradeModal } = useProGate();
  const { isMobile, isDesktop } = useResponsive();
  const numColumns = isDesktop ? 2 : 1;

  const [activeTab, setActiveTab] = useState<"discover" | "following">("discover");

  // Each feed has its own state — tab switching never resets the other feed
  const [discoverPosts, setDiscoverPosts] = useState<CommunityPost[]>([]);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverRefreshing, setDiscoverRefreshing] = useState(false);
  const [discoverHasMore, setDiscoverHasMore] = useState(true);
  const discoverPageRef = useRef(0);
  const isFetchingDiscoverRef = useRef(false);

  const [followingPosts, setFollowingPosts] = useState<CommunityPost[]>([]);
  const [followingError, setFollowingError] = useState<string | null>(null);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followingRefreshing, setFollowingRefreshing] = useState(false);
  const [followingHasMore, setFollowingHasMore] = useState(true);
  const followingPageRef = useRef(0);
  const isFetchingFollowingRef = useRef(false);

  // ── Ensure user_profile row exists ──────────────────────────────────────────
  React.useEffect(() => {
    async function ensureUserProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("user_profiles").upsert(
        { id: user.id, username: user.email?.split("@")[0] ?? "plant_lover", created_at: new Date().toISOString() },
        { onConflict: "id", ignoreDuplicates: true }
      );
    }
    ensureUserProfile();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch Discover ───────────────────────────────────────────────────────────
  const fetchDiscover = useCallback(async (reset = false) => {
    if (!profile) return;
    if (isFetchingDiscoverRef.current) return;
    isFetchingDiscoverRef.current = true;

    if (reset) {
      discoverPageRef.current = 0;
      setDiscoverHasMore(true);
      setDiscoverError(null);
    }
    setDiscoverLoading(true);
    try {
      const { rows, error } = await fetchFeedRows(profile.id, discoverPageRef.current * PAGE_SIZE);
      if (error) throw error;
      const mapped = await enrichRows(rows, profile.id);
      if (reset) setDiscoverPosts(mapped);
      else setDiscoverPosts((prev) => [...prev, ...mapped]);
      setDiscoverHasMore(mapped.length === PAGE_SIZE);
      discoverPageRef.current += 1;
    } catch (err) {
      setDiscoverError(String(err));
    } finally {
      isFetchingDiscoverRef.current = false;
      setDiscoverLoading(false);
      setDiscoverRefreshing(false);
    }
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch Following ──────────────────────────────────────────────────────────
  const fetchFollowing = useCallback(async (reset = false) => {
    if (!profile) return;
    if (isFetchingFollowingRef.current) return;
    isFetchingFollowingRef.current = true;

    if (reset) {
      followingPageRef.current = 0;
      setFollowingHasMore(true);
      setFollowingError(null);
    }
    setFollowingLoading(true);
    try {
      const { data: followData } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", profile.id);
      const followedIds = (followData ?? []).map((f: { following_id: string }) => f.following_id);

      const { rows, error } = await fetchFeedRows(profile.id, followingPageRef.current * PAGE_SIZE, followedIds);
      if (error) throw error;
      const mapped = await enrichRows(rows, profile.id);
      if (reset) setFollowingPosts(mapped);
      else setFollowingPosts((prev) => [...prev, ...mapped]);
      setFollowingHasMore(mapped.length === PAGE_SIZE);
      followingPageRef.current += 1;
    } catch (err) {
      setFollowingError(String(err));
    } finally {
      isFetchingFollowingRef.current = false;
      setFollowingLoading(false);
      setFollowingRefreshing(false);
    }
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch both feeds once on mount — no useFocusEffect, no tab-switching triggers
  React.useEffect(() => {
    if (!profile) return;
    fetchDiscover(true);
    fetchFollowing(true);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply any comment-count changes made while viewing a post detail, then clear.
  // Uses a module-level Map to avoid network requests; safe on tab switch (no-op when map is empty).
  useFocusEffect(
    useCallback(() => {
      if (commentCountUpdates.size === 0) return;
      const patch = (prev: CommunityPost[]) =>
        prev.map((p) => {
          const updated = commentCountUpdates.get(p.id);
          return updated !== undefined ? { ...p, comments_count: updated } : p;
        });
      setDiscoverPosts(patch);
      setFollowingPosts(patch);
      commentCountUpdates.clear();
    }, [])
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    if (activeTab === "discover") {
      setDiscoverRefreshing(true);
      fetchDiscover(true);
    } else {
      setFollowingRefreshing(true);
      fetchFollowing(true);
    }
  }, [activeTab, fetchDiscover, fetchFollowing]);

  const handleLoadMore = useCallback(() => {
    if (activeTab === "discover" && !discoverLoading && discoverHasMore) {
      fetchDiscover(false);
    } else if (activeTab === "following" && !followingLoading && followingHasMore) {
      fetchFollowing(false);
    }
  }, [activeTab, discoverLoading, discoverHasMore, followingLoading, followingHasMore, fetchDiscover, fetchFollowing]);

  const handleLike = useCallback(async (postId: string, isLiked: boolean) => {
    if (!profile) return;
    const update = (prev: CommunityPost[]) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, is_liked: !isLiked, likes_count: p.likes_count + (isLiked ? -1 : 1) }
          : p
      );
    const revert = (prev: CommunityPost[]) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, is_liked: isLiked, likes_count: p.likes_count + (isLiked ? 1 : -1) }
          : p
      );
    // Optimistic update on both feeds (post may appear in both)
    setDiscoverPosts(update);
    setFollowingPosts(update);
    try {
      if (isLiked) {
        await supabase.from("post_likes").delete().eq("user_id", profile.id).eq("post_id", postId);
      } else {
        await supabase.from("post_likes").insert({ user_id: profile.id, post_id: postId });
      }
    } catch {
      setDiscoverPosts(revert);
      setFollowingPosts(revert);
    }
  }, [profile]);

  const handleComment = useCallback((postId: string) => {
    router.push({ pathname: "/community/post/[id]", params: { id: postId } });
  }, [router]);

  const handleShare = useCallback(async (postId: string) => {
    const post = [...discoverPosts, ...followingPosts].find((p) => p.id === postId);
    const message = post?.caption
      ? `${post.caption}\n\n${t("community.sharedVia")}`
      : t("community.sharedVia");
    await Share.share({ message });
  }, [discoverPosts, followingPosts, t]);

  const handleProfile = useCallback((userId: string) => {
    router.push({ pathname: "/community/profile/[id]", params: { id: userId } });
  }, [router]);

  const handleFabPress = useCallback(() => {
    if (activeTab === "discover") {
      if (!requirePro(t("paywall.featureCommunity"))) return;
      router.push("/community/new-post");
    } else {
      Share.share({ message: t("community.inviteMessage") });
    }
  }, [activeTab, requirePro, router, t]);

  const [fabHeight, setFabHeight] = useState(0);

  // ── Derived per-tab values for the active feed ───────────────────────────────
  const isDiscover = activeTab === "discover";
  const loading = isDiscover ? discoverLoading : followingLoading;
  const refreshing = isDiscover ? discoverRefreshing : followingRefreshing;
  const fetchError = isDiscover ? discoverError : followingError;
  const retryFetch = isDiscover ? () => fetchDiscover(true) : () => fetchFollowing(true);

  function renderFeed(feed: CommunityPost[], visible: boolean, feedId: string) {
    return (
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        key={`${feedId}-${numColumns}`}
        numColumns={numColumns}
        columnWrapperStyle={isDesktop ? { gap: 8, paddingHorizontal: 8 } : undefined}
        style={{ display: visible ? "flex" : "none" }}
        renderItem={({ item }) => {
          const card = (
            <PostCard
              post={item}
              currentUserId={profile?.id ?? ""}
              onLike={handleLike}
              onComment={handleComment}
              onShare={handleShare}
              onProfile={handleProfile}
            />
          );
          return isDesktop
            ? <View style={{ flex: 1, maxWidth: "49%" }}>{card}</View>
            : card;
        }}
        contentContainerStyle={{ paddingBottom: fabHeight + 16 }}
        refreshControl={
          <RefreshControl
            refreshing={visible ? refreshing : false}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          visible && !loading ? (
            fetchError ? (
              <TouchableOpacity style={styles.emptyState} onPress={retryFetch} activeOpacity={0.7}>
                <Users size={48} color={COLORS.textSecondary} />
                <Text style={styles.emptyTitle}>{t("community.loadError")}</Text>
                <Text style={styles.emptySubtitle}>{t("community.tapToRetry")}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.emptyState}>
                <Users size={48} color={COLORS.textSecondary} />
                <Text style={styles.emptyTitle}>
                  {isDiscover ? t("community.noPostsYet") : t("community.followSomeone")}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {isDiscover ? t("community.beFirstToPost") : t("community.noFollowingPosts")}
                </Text>
              </View>
            )
          ) : null
        }
        ListFooterComponent={
          visible && loading && feed.length > 0
            ? <ActivityIndicator color={COLORS.primary} style={{ padding: 20 }} />
            : null
        }
      />
    );
  }

  return (
    <ResponsiveContainer>
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t("community.tab")}</Text>

        {/* Sub-tabs */}
        <View style={styles.subTabs}>
          <TouchableOpacity
            style={[styles.subTab, isDiscover && styles.subTabActive]}
            onPress={() => setActiveTab("discover")}
          >
            <Text style={[styles.subTabText, isDiscover && styles.subTabTextActive]}>
              {t("community.discover")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subTab, !isDiscover && styles.subTabActive]}
            onPress={() => setActiveTab("following")}
          >
            <Text style={[styles.subTabText, !isDiscover && styles.subTabTextActive]}>
              {t("community.following")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Both feeds always mounted — show/hide via display style to avoid remounts */}
      {renderFeed(discoverPosts, isDiscover, "discover")}
      {renderFeed(followingPosts, !isDiscover, "following")}

      {/* FAB */}
      <View
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onLayout={(e) => setFabHeight(e.nativeEvent.layout.height + 24 + insets.bottom)}
      >
        <TouchableOpacity
          style={styles.fabButton}
          onPress={handleFabPress}
          activeOpacity={0.85}
          accessibilityLabel={activeTab === "discover" ? t("community.sharePost") : t("community.inviteFriends")}
          accessibilityRole="button"
        >
          {activeTab === "discover" ? (
            <Plus size={26} color="#fff" />
          ) : (
            <Share2 size={24} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      <UpgradeModal
        visible={upgradeModalVisible}
        featureName={lockedFeatureName}
        onClose={closeUpgradeModal}
        onUpgrade={() => {
          closeUpgradeModal();
          router.push("/paywall");
        }}
      />
    </View>
    </ResponsiveContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#EFEFEF",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subTabs: {
    flexDirection: "row",
    gap: 4,
  },
  subTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  subTabActive: {
    borderBottomColor: COLORS.primary,
  },
  subTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  subTabTextActive: {
    color: COLORS.primary,
  },

  // Post card
  postCard: {
    backgroundColor: "#fff",
    marginHorizontal: 0,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
  },
  postHeaderInfo: { flex: 1 },
  postUsername: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  plantTag: {
    fontSize: 12,
    color: COLORS.secondary,
    marginTop: 1,
  },
  postTime: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  postPhoto: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#E5E7EB",
  },
  postActions: {
    flexDirection: "row",
    padding: 12,
    gap: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  actionCount: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  actionCountLiked: {
    color: COLORS.danger,
  },
  captionContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  captionText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  expandText: {
    color: COLORS.secondary,
    fontWeight: "600",
  },

  // Avatar
  avatarPlaceholder: {
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontWeight: "700",
    color: COLORS.primary,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },

  // FAB
  fab: {
    position: "absolute",
    right: 20,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
