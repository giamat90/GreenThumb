import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Leaf, Sprout } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { COLORS } from "@/constants";
import { sendCommunityNotification } from "@/lib/communityNotifications";
import { fetchKudoedPlantIds, togglePlantKudos } from "@/lib/plantKudos";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/store/user";
import type { CommunityPost, UserProfile } from "@/types";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 4) / 3;

type PlantPreview = {
  id: string;
  name: string;
  species: string | null;
  photo_url: string | null;
  health_score: number;
  kudos_count: number;
};

export default function PublicProfileScreen() {
  const { t } = useTranslation();
  const { id: userId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: currentProfile } = useUserStore();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowedBy, setIsFollowedBy] = useState(false);
  const [userPlants, setUserPlants] = useState<PlantPreview[]>([]);
  const [kudoedPlantIds, setKudoedPlantIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);

  const isOwnProfile = userId === currentProfile?.id;

  const fetchProfile = useCallback(async () => {
    if (!userId || !currentProfile) return;
    setLoading(true);
    try {
      const [profileResult, postsResult, followResult, followedByResult] = await Promise.all([
        supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle(),
        supabase
          .from("posts")
          .select("id, photo_url, likes_count, comments_count, created_at")
          .eq("user_id", userId)
          .eq("is_public", true)
          .order("created_at", { ascending: false }),
        // Does viewer follow profile owner?
        supabase
          .from("follows")
          .select("id")
          .eq("follower_id", currentProfile.id)
          .eq("following_id", userId)
          .maybeSingle(),
        // Does profile owner follow viewer back?
        supabase
          .from("follows")
          .select("id")
          .eq("follower_id", userId)
          .eq("following_id", currentProfile.id)
          .maybeSingle(),
      ]);

      if (profileResult.data) {
        setUserProfile(profileResult.data as UserProfile);
      }

      const mappedPosts: CommunityPost[] = (postsResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        user_id: userId,
        plant_id: null,
        photo_url: row.photo_url as string,
        caption: null,
        likes_count: row.likes_count as number,
        comments_count: row.comments_count as number,
        is_public: true,
        created_at: row.created_at as string,
      }));
      setPosts(mappedPosts);

      const following = !!followResult.data;
      const followedBy = !!followedByResult.data;
      setIsFollowing(following);
      setIsFollowedBy(followedBy);

      // Fetch plants — RLS allows: own profile always, mutual follow if both follow each other
      const isMutual = following && followedBy;
      if (isOwnProfile || isMutual) {
        const { data: plantsData } = await supabase
          .from("plants")
          .select("id, name, species, photo_url, health_score, kudos_count")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        const plants = (plantsData ?? []) as PlantPreview[];
        setUserPlants(plants);
        if (!isOwnProfile && plants.length > 0) {
          const kudoed = await fetchKudoedPlantIds(currentProfile.id, plants.map((p) => p.id));
          setKudoedPlantIds(kudoed);
        }
      } else {
        setUserPlants([]);
        setKudoedPlantIds(new Set());
      }
    } catch (err) {
      console.warn("profile: fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [userId, currentProfile, isOwnProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleFollow = useCallback(async () => {
    if (!currentProfile || !userId) return;
    setFollowLoading(true);
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    try {
      if (wasFollowing) {
        await supabase.from("follows").delete().eq("follower_id", currentProfile.id).eq("following_id", userId);
        // If unfollowing, mutual follow is broken — clear plants
        if (isFollowedBy) setUserPlants([]);
      } else {
        await supabase.from("follows").insert({ follower_id: currentProfile.id, following_id: userId });
        sendCommunityNotification({ type: "follow", targetUserId: userId });
        // If now mutual, re-fetch plants
        if (isFollowedBy) {
          const { data: plantsData } = await supabase
            .from("plants")
            .select("id, name, species, photo_url, health_score, kudos_count")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
          const plants = (plantsData ?? []) as PlantPreview[];
          setUserPlants(plants);
          if (plants.length > 0) {
            const kudoed = await fetchKudoedPlantIds(currentProfile.id, plants.map((p) => p.id));
            setKudoedPlantIds(kudoed);
          }
        }
      }
    } catch {
      setIsFollowing(wasFollowing);
    } finally {
      setFollowLoading(false);
    }
  }, [currentProfile, userId, isFollowing, isFollowedBy]);

  const handlePlantKudos = useCallback(async (plant: PlantPreview) => {
    if (!currentProfile || isOwnProfile) return;
    const wasKudoed = kudoedPlantIds.has(plant.id);
    const next = new Set(kudoedPlantIds);
    if (wasKudoed) next.delete(plant.id); else next.add(plant.id);
    setKudoedPlantIds(next);
    setUserPlants((prev) =>
      prev.map((p) =>
        p.id === plant.id
          ? { ...p, kudos_count: p.kudos_count + (wasKudoed ? -1 : 1) }
          : p
      )
    );
    try {
      await togglePlantKudos(plant.id, currentProfile.id, wasKudoed);
      if (!wasKudoed) {
        sendCommunityNotification({ type: "kudos", plantId: plant.id });
      }
    } catch {
      setKudoedPlantIds(kudoedPlantIds);
      setUserPlants((prev) =>
        prev.map((p) =>
          p.id === plant.id
            ? { ...p, kudos_count: p.kudos_count + (wasKudoed ? 1 : -1) }
            : p
        )
      );
    }
  }, [currentProfile, isOwnProfile, kudoedPlantIds]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const username = userProfile?.username ?? "User";
  const postCount = posts.length;
  const isMutualFollow = isFollowing && isFollowedBy;
  const showPlants = isOwnProfile || isMutualFollow;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={{ gap: 2 }}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListHeaderComponent={
          <View>
            {/* Top bar */}
            <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
              <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                <ArrowLeft size={20} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Profile info */}
            <View style={styles.profileSection}>
              {/* Avatar */}
              {userProfile?.avatar_url ? (
                <Image source={{ uri: userProfile.avatar_url }} style={styles.avatarLarge} />
              ) : (
                <View style={styles.avatarLarge}>
                  <Text style={styles.avatarInitials}>{username.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}

              <Text style={styles.username}>{username}</Text>
              {userProfile?.bio && <Text style={styles.bio}>{userProfile.bio}</Text>}

              {/* Stats */}
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{postCount}</Text>
                  <Text style={styles.statLabel}>{t("community.posts")}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{userProfile?.followers_count ?? 0}</Text>
                  <Text style={styles.statLabel}>{t("community.followers")}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{userProfile?.following_count ?? 0}</Text>
                  <Text style={styles.statLabel}>{t("community.followingCount")}</Text>
                </View>
              </View>

              {/* Follow button */}
              {!isOwnProfile && (
                <TouchableOpacity
                  style={[styles.followBtn, isFollowing && styles.followingBtn]}
                  onPress={handleFollow}
                  disabled={followLoading}
                  activeOpacity={0.85}
                >
                  {followLoading ? (
                    <ActivityIndicator color={isFollowing ? COLORS.primary : "#fff"} size="small" />
                  ) : (
                    <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                      {isFollowing ? t("community.unfollow") : t("community.follow")}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Plants section — visible only to own profile or mutual followers */}
            {showPlants && userPlants.length > 0 && (
              <View style={styles.plantsSection}>
                <Text style={styles.plantsSectionTitle}>{t("community.plantsSection")}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.plantsRow}
                >
                  {userPlants.map((plant) => {
                    const isKudoed = kudoedPlantIds.has(plant.id);
                    return (
                      <View key={plant.id} style={styles.plantCard}>
                        {plant.photo_url ? (
                          <Image source={{ uri: plant.photo_url }} style={styles.plantCardPhoto} />
                        ) : (
                          <View style={styles.plantCardPhotoPlaceholder}>
                            <Leaf size={24} color={COLORS.primary} />
                          </View>
                        )}
                        <Text style={styles.plantCardName} numberOfLines={1}>{plant.name}</Text>
                        {plant.species ? (
                          <Text style={styles.plantCardSpecies} numberOfLines={1}>{plant.species}</Text>
                        ) : null}
                        <View style={styles.plantCardHealthBar}>
                          <View
                            style={[
                              styles.plantCardHealthFill,
                              {
                                width: `${plant.health_score}%` as `${number}%`,
                                backgroundColor:
                                  plant.health_score >= 70
                                    ? COLORS.primary
                                    : plant.health_score >= 40
                                    ? "#F59E0B"
                                    : COLORS.danger,
                              },
                            ]}
                          />
                        </View>
                        {/* Kudos row */}
                        <TouchableOpacity
                          style={styles.plantCardKudosRow}
                          onPress={isOwnProfile ? undefined : () => handlePlantKudos(plant)}
                          activeOpacity={isOwnProfile ? 1 : 0.7}
                          accessibilityRole={isOwnProfile ? "none" : "button"}
                        >
                          <Sprout
                            size={12}
                            color={isKudoed ? COLORS.primary : COLORS.textSecondary}
                            fill={isKudoed ? COLORS.primary : "transparent"}
                          />
                          <Text style={[styles.plantCardKudosCount, isKudoed && { color: COLORS.primary }]}>
                            {plant.kudos_count}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Divider */}
            <View style={styles.divider} />
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/community/post/[id]", params: { id: item.id } })}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: item.photo_url }}
              style={{ width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE, backgroundColor: "#E5E7EB" }}
              resizeMode="cover"
            />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyGrid}>
            <Text style={styles.emptyText}>{t("community.noPostsYet")}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.cream },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.cream },
  topBar: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: "#fff" },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.cream, alignItems: "center", justifyContent: "center",
  },
  profileSection: {
    backgroundColor: "#fff", paddingHorizontal: 20, paddingBottom: 24,
    alignItems: "center", gap: 10,
  },
  avatarLarge: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitials: { fontSize: 28, fontWeight: "700", color: COLORS.primary },
  username: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary },
  bio: { fontSize: 14, color: COLORS.textSecondary, textAlign: "center", lineHeight: 20 },
  statsRow: { flexDirection: "row", gap: 32, marginTop: 8 },
  stat: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  statLabel: { fontSize: 12, color: COLORS.textSecondary },
  followBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 32, paddingVertical: 10, marginTop: 8,
  },
  followingBtn: {
    backgroundColor: "transparent", borderWidth: 1.5, borderColor: COLORS.primary,
  },
  followBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  followingBtnText: { color: COLORS.primary },

  // ── Plants section ────────────────────────────────────────────────────────
  plantsSection: {
    backgroundColor: "#fff",
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  plantsSectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  plantsRow: {
    gap: 10,
    paddingBottom: 4,
  },
  plantCard: {
    width: 100,
    backgroundColor: COLORS.cream,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
    paddingBottom: 8,
  },
  plantCardPhoto: {
    width: 100,
    height: 80,
  },
  plantCardPhotoPlaceholder: {
    width: 100,
    height: 80,
    backgroundColor: COLORS.lightgreen,
    alignItems: "center",
    justifyContent: "center",
  },
  plantCardName: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: 6,
    paddingHorizontal: 8,
  },
  plantCardSpecies: {
    fontSize: 10,
    color: COLORS.textSecondary,
    paddingHorizontal: 8,
    marginTop: 1,
  },
  plantCardHealthBar: {
    height: 3,
    backgroundColor: "#E5E7EB",
    borderRadius: 2,
    marginHorizontal: 8,
    marginTop: 6,
    overflow: "hidden",
  },
  plantCardHealthFill: {
    height: 3,
    borderRadius: 2,
  },
  plantCardKudosRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    marginTop: 5,
  },
  plantCardKudosCount: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: "600",
  },

  divider: { height: 1, backgroundColor: "#EFEFEF", marginTop: 8 },
  emptyGrid: { padding: 40, alignItems: "center" },
  emptyText: { fontSize: 15, color: COLORS.textSecondary },
});
