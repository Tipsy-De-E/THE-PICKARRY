import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Package, CreditCard, Clock, Smartphone, DollarSign, Home,
  FileText, Calendar, Menu, Search, Filter, ChevronDown, User,
  MessageSquare, X, Bell, Truck, Navigation, Phone, Mail, Heart, Trash2,
  CheckCircle, PlayCircle, TruckIcon, AlertTriangle, Loader2, Download,
  MessageCircle, Star, Percent, Zap
} from 'lucide-react';
import { clearUserSession, getCurrentUser } from '../../utils/auth';
import { supabase } from '../../utils/supabaseClient';
import logo from '../../assets/images/LOGO.png';
import '../../styles/courier-book.css';
import { notificationService } from '../../hooks/notificationService';
import NotificationDropdown from '../../components/NotificationDropdown';

const CourierBook = () => {
  const navigate = useNavigate();
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [remarks, setRemarks] = useState({});
  const [customerFeedback, setCustomerFeedback] = useState({});
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [currentOrderRemark, setCurrentOrderRemark] = useState('');
  const [selectedOrderForRemarks, setSelectedOrderForRemarks] = useState(null);
  const [activeTab, setActiveTab] = useState('current');
  const [activeService, setActiveService] = useState('All');
  const [activeStatus, setActiveStatus] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showOrderDetailsModal, setShowOrderDetailsModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showStatusUpdateModal, setShowStatusUpdateModal] = useState(false);
  const [showPaymentBreakdownModal, setShowPaymentBreakdownModal] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentBookingsState, setCurrentBookingsState] = useState([]);
  const [completedBookingsState, setCompletedBookingsState] = useState([]);
  const [realTimeSubscription, setRealTimeSubscription] = useState(null);
  const [updatingOrder, setUpdatingOrder] = useState(null);
  const [profileImage, setProfileImage] = useState('');

  // CANCELLATION TIMER STATE
  const [cancellationTimer, setCancellationTimer] = useState(null);
  const [isCancellingWithTimer, setIsCancellingWithTimer] = useState(false);

  // FARE MANAGEMENT STATE
  const [fareConfig, setFareConfig] = useState(null);
  const [vehicleRates, setVehicleRates] = useState([]);
  const [distanceSettings, setDistanceSettings] = useState([]);
  const [fareLoading, setFareLoading] = useState(false);

  // Check authentication and load data
  useEffect(() => {
    checkAuthentication();
    fetchFareData();
    return () => {
      if (realTimeSubscription) {
        realTimeSubscription.unsubscribe();
      }
    };
  }, []);

  // Set up real-time subscription for profile updates
  useEffect(() => {
    if (!userData?.id) return;

    const subscription = supabase
      .channel(`courier-profile-${userData.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'couriers',
          filter: `id=eq.${userData.id}`
        },
        (payload) => {
          console.log('Profile updated in real-time:', payload.new);
          if (payload.new.profile_image && payload.new.profile_image !== profileImage) {
            setProfileImage(payload.new.profile_image);
            setUserData(prev => ({
              ...prev,
              profile_image: payload.new.profile_image
            }));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [userData?.id, profileImage]);

  // Load orders when user data is available or tab changes
  useEffect(() => {
    if (userData) {
      loadOrders();
      setupRealtimeSubscription();
    }
  }, [userData, activeTab]);

  // FIXED: Load remarks and customer feedback after orders are loaded
  useEffect(() => {
    if (userData && (currentBookingsState.length > 0 || completedBookingsState.length > 0)) {
      loadRemarks();
      loadCustomerFeedback();
    }
  }, [userData, currentBookingsState, completedBookingsState]);

  // Fetch fare configuration data
  const fetchFareData = async () => {
    try {
      setFareLoading(true);

      // Fetch fare configuration
      const { data: configData, error: configError } = await supabase
        .from('fare_configuration')
        .select('*')
        .eq('is_active', true)
        .single();

      if (configError && configError.code !== 'PGRST116') {
        throw configError;
      }

      if (configData) {
        setFareConfig(configData);
      } else {
        // Use default values if no config exists
        setFareConfig({
          time_rate_per_minute: 9,
          platform_commission: 0.8,
          bonus_rate: 3,
          penalty_rate_per_minute: 32,
          grace_period_seconds: 320
        });
      }

      // Fetch vehicle rates
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicle_rates')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (vehicleError) throw vehicleError;

      if (vehicleData) {
        setVehicleRates(vehicleData);
      }

      // Fetch distance settings
      const { data: distanceData, error: distanceError } = await supabase
        .from('distance_fare_settings')
        .select('*')
        .eq('is_active', true)
        .order('min_distance');

      if (distanceError) throw distanceError;

      if (distanceData) {
        setDistanceSettings(distanceData);
      }

    } catch (error) {
      console.error('Error fetching fare data:', error);
    } finally {
      setFareLoading(false);
    }
  };

  // Calculate dynamic fare based on fare configuration
  const calculateFare = (vehicleType, distance, estimatedTime, isRush = false, waitTime = 0) => {
    if (!fareConfig || !vehicleRates.length) {
      console.warn('Fare configuration not loaded');
      return {
        subtotal: 0,
        platformFee: 0,
        total: 0,
        breakdown: {
          baseFare: 0,
          distanceCost: 0,
          timeCost: 0,
          penaltyCost: 0,
          rushBonus: 0,
          platformFee: 0
        }
      };
    }

    const vehicle = vehicleRates.find(v => v.vehicle_type === vehicleType);
    if (!vehicle) {
      console.warn(`Vehicle type not found: ${vehicleType}`);
      return {
        subtotal: 0,
        platformFee: 0,
        total: 0,
        breakdown: {
          baseFare: 0,
          distanceCost: 0,
          timeCost: 0,
          penaltyCost: 0,
          rushBonus: 0,
          platformFee: 0
        }
      };
    }

    // Get distance multiplier
    const distanceSetting = distanceSettings.find(setting =>
      distance >= setting.min_distance && distance < setting.max_distance
    ) || { base_multiplier: 1.0, time_multiplier: 1.0 };

    // Calculate base components
    const baseFare = vehicle.base_fare * distanceSetting.base_multiplier;
    const distanceCost = distance * vehicle.distance_rate_per_km;
    const timeCost = estimatedTime * fareConfig.time_rate_per_minute * distanceSetting.time_multiplier;

    // Calculate penalty if wait time exceeds grace period
    const gracePeriodMinutes = fareConfig.grace_period_seconds / 60;
    const penaltyTime = Math.max(0, waitTime - gracePeriodMinutes);
    const penaltyCost = penaltyTime * fareConfig.penalty_rate_per_minute;

    // Add rush bonus
    const rushBonus = isRush ? fareConfig.bonus_rate : 0;

    const subtotal = baseFare + distanceCost + timeCost + penaltyCost + rushBonus;

    // Apply platform commission
    const platformFee = subtotal * (fareConfig.platform_commission / 100);

    return {
      subtotal: subtotal,
      platformFee: platformFee,
      total: subtotal + platformFee,
      breakdown: {
        baseFare,
        distanceCost,
        timeCost,
        penaltyCost,
        rushBonus,
        platformFee
      }
    };
  };

  // Check authentication
  const checkAuthentication = async () => {
    try {
      setLoading(true);
      const session = getCurrentUser();

      if (!session) {
        navigate('/customer/auth');
        return;
      }

      // Check if user is a registered courier
      const { data: courierData, error } = await supabase
        .from('couriers')
        .select('*')
        .eq('email', session.email)
        .single();

      if (error || !courierData) {
        console.log('User is not a registered courier');
        navigate('/customer/home');
        return;
      }

      // Set user data for display including profile image
      setUserData({
        id: courierData.id,
        name: courierData.full_name || 'Courier',
        email: courierData.email || 'courier@gmail.com',
        initials: (courierData.full_name || 'Courier').charAt(0),
        vehicle: courierData.vehicle_type,
        profile_image: courierData.profile_image || ''
      });

      // Set profile image if available
      if (courierData.profile_image) {
        setProfileImage(courierData.profile_image);
      }

    } catch (error) {
      console.error('Authentication check error:', error);
      navigate('/customer/auth');
    } finally {
      setLoading(false);
    }
  };

  // FIXED: Enhanced load customer feedback for all orders
  const loadCustomerFeedback = async () => {
    try {
      console.log('Loading customer feedback for courier book');

      // Get all order IDs from both current and completed bookings
      const allOrders = [...currentBookingsState, ...completedBookingsState];
      const orderIds = allOrders.map(order => order.id);

      if (!orderIds || orderIds.length === 0) {
        console.log('No order IDs available for customer feedback');
        setCustomerFeedback({});
        return;
      }

      const { data, error } = await supabase
        .from('order_remarks')
        .select('order_id, remark, created_by, recipient_user_type, created_at')
        .in('order_id', orderIds)
        .eq('recipient_user_type', 'courier') // Feedback from customer to courier
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customer feedback:', error);
        throw error;
      }

      console.log('Customer feedback data received:', data);

      const customerFeedbackObj = {};

      // Group by order_id and take only the latest feedback for each order
      data.forEach(item => {
        if (!customerFeedbackObj[item.order_id]) {
          customerFeedbackObj[item.order_id] = {
            remark: item.remark,
            date: item.created_at,
            created_by: item.created_by
          };
        }
      });

      console.log('Processed customer feedback:', customerFeedbackObj);
      setCustomerFeedback(customerFeedbackObj);
    } catch (error) {
      console.error('Error loading customer feedback:', error);
    }
  };

  // Load orders from Supabase
  const loadOrders = async () => {
    try {
      if (activeTab === 'current') {
        // Load current bookings (accepted but not delivered/cancelled)
        const { data: currentOrders, error } = await supabase
          .from('orders')
          .select(`
            *,
            customers:customer_id (
              full_name,
              email,
              phone
            )
          `)
          .eq('courier_id', userData.id)
          .eq('book_for_delivery', true)
          .in('status', ['accepted', 'picked_up', 'on_the_way', 'arrived'])
          .order('created_at', { ascending: false });

        if (error) throw error;

        const formattedCurrentOrders = (currentOrders || []).map(order => formatOrderData(order));
        setCurrentBookingsState(formattedCurrentOrders);

      } else {
        // Load completed bookings (delivered or cancelled)
        const { data: completedOrders, error } = await supabase
          .from('orders')
          .select(`
            *,
            customers:customer_id (
              full_name,
              email,
              phone
            ),
            courier_earnings (
              amount
            )
          `)
          .eq('courier_id', userData.id)
          .eq('book_for_delivery', true)
          .in('status', ['completed', 'delivered', 'cancelled'])
          .order('created_at', { ascending: false });

        if (error) throw error;

        const formattedCompletedOrders = (completedOrders || []).map(order => formatOrderData(order));
        setCompletedBookingsState(formattedCompletedOrders);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  // Format order data from Supabase
  const formatOrderData = (order) => {
    // Handle uploaded_photos - it could be string, array, or null
    let images = [];
    if (order.uploaded_photos) {
      if (Array.isArray(order.uploaded_photos)) {
        images = order.uploaded_photos;
      } else if (typeof order.uploaded_photos === 'string') {
        try {
          // Try to parse as JSON array
          images = JSON.parse(order.uploaded_photos);
        } catch {
          // If it's a single string, wrap in array
          images = [order.uploaded_photos];
        }
      }
    }

    const statusMap = {
      'pending': 'Pending',
      'accepted': 'Accepted',
      'in_progress': 'In Progress',
      'picked_up': 'In Progress',
      'on_the_way': 'In Progress',
      'arrived': 'In Progress',
      'delivered': 'Completed',
      'cancelled': 'Cancelled'
    };

    const deliveryStatusMap = {
      'pending': 'pending',
      'accepted': 'accepted',
      'in_progress': 'on_the_way',
      'picked_up': 'picked_up',
      'on_the_way': 'on_the_way',
      'arrived': 'arrived',
      'delivered': 'delivered',
      'cancelled': 'cancelled'
    };

    const status = statusMap[order.status] || 'Pending';
    const deliveryStatus = deliveryStatusMap[order.status] || 'pending';

    // Calculate actual fare breakdown if available, otherwise use stored data
    let fareBreakdown = order.fare_breakdown;
    if (!fareBreakdown && order.estimated_distance && order.selected_vehicle) {
      const calculatedFare = calculateFare(
        order.selected_vehicle,
        order.estimated_distance,
        order.estimated_duration || 15,
        order.is_rush_delivery
      );
      fareBreakdown = calculatedFare.breakdown;
    }

    return {
      id: order.id,
      orderNumber: `ORD-${order.id.slice(-8).toUpperCase()}`,
      pickupLocation: order.pickup_location,
      deliveryLocation: order.delivery_location,
      item: order.delivery_item,
      category: order.selected_category,
      description: order.description,
      payment: order.total_amount,
      paymentMethod: order.payment_method,
      vehicleType: order.selected_vehicle,
      date: order.book_for_delivery && order.delivery_date
        ? `Book: ${new Date(order.delivery_date).toLocaleDateString()} ${order.delivery_time}`
        : `Today: ${order.delivery_time}`,
      status: status,
      deliveryStatus: deliveryStatus,
      customerName: order.customers?.full_name || 'Customer',
      phone: order.customers?.phone || 'No phone',
      email: order.customers?.email || 'No email',
      serviceType: order.selected_service,
      distance: order.estimated_distance,
      estimatedTime: '10-15 mins',
      items: [
        {
          name: order.delivery_item,
          quantity: 1,
          price: parseFloat(order.total_amount || 0) - (order.is_rush_delivery ? parseFloat(order.rush_amount || 0) : 0)
        }
      ],
      images: images,
      rushAmount: order.rush_amount,
      isRushDelivery: order.is_rush_delivery,
      earnings: order.courier_earnings?.[0]?.amount ? `₱${parseFloat(order.courier_earnings[0].amount).toFixed(2)}` : '₱0.00',
      pendingAt: new Date(order.created_at).getTime(),
      acceptedAt: order.accepted_at ? new Date(order.accepted_at).getTime() : null,
      supabaseData: order,
      fare_breakdown: fareBreakdown,
      estimated_distance: order.estimated_distance,
      estimated_duration: order.estimated_duration
    };
  };

  // Setup realtime subscription for order updates
  const setupRealtimeSubscription = () => {
    const subscription = supabase
      .channel('courier-book-orders')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `courier_id=eq.${userData.id}`
        },
        (payload) => {
          console.log('Order update received:', payload);
          loadOrders(); // Reload orders when changes occur
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_remarks'
        },
        (payload) => {
          console.log('Remarks update received:', payload);
          // Refresh both remarks and customer feedback when remarks change
          loadRemarks();
          loadCustomerFeedback();
        }
      )
      .subscribe();

    setRealTimeSubscription(subscription);
  };

  // Enhanced update delivery status with notifications
  const updateDeliveryStatus = async (orderId, newStatus) => {
    try {
      setUpdatingOrder(orderId);

      // Define timestamp fields for each status
      const timestampFields = {
        'picked_up': 'picked_up_at',
        'on_the_way': 'on_the_way_at',
        'arrived': 'arrived_at',
        'delivered': 'delivered_at'
      };

      const updates = {
        status: newStatus,
        courier_status: newStatus,
        updated_at: new Date().toISOString(),
      };

      // Add timestamp if this status has one
      if (timestampFields[newStatus]) {
        updates[timestampFields[newStatus]] = new Date().toISOString();
      }

      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId);

      if (error) {
        console.error('Error updating status:', error);
        alert('Failed to update status.');
        return;
      }

      // Record in order status history
      const statusDescriptions = {
        'picked_up': 'Package picked up from location',
        'on_the_way': 'On the way to destination',
        'arrived': 'Arrived at destination',
        'delivered': 'Delivery completed successfully'
      };

      await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          status: newStatus,
          courier_status: newStatus,
          notes: statusDescriptions[newStatus] || `Status updated to ${newStatus}`
        });

      // If order is delivered, record earnings
      if (newStatus === 'delivered') {
        const order = currentBookingsState.find(o => o.id === orderId);
        if (order) {
          await supabase
            .from('courier_earnings')
            .insert({
              courier_id: userData.id,
              order_id: orderId,
              amount: order.payment,
              type: 'booking',
              description: `Earnings from booking order ${order.orderNumber}`
            });
        }
      }

      // Send enhanced notification to customer
      try {
        const order = currentBookingsState.find(o => o.id === orderId);
        if (order && order.supabaseData) {
          if (newStatus === 'picked_up' || newStatus === 'on_the_way' || newStatus === 'arrived') {
            await notificationService.notifyDeliveryProgress(
              orderId,
              order.supabaseData.customers?.email,
              newStatus,
              userData.name,
              order.estimatedTime
            );
          } else if (newStatus === 'delivered') {
            await notificationService.notifyOrderStatusUpdate(
              orderId,
              'delivered',
              order.supabaseData.customers?.email,
              { courier_name: userData.name }
            );
          }
        }
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
      }

      console.log(`Order ${orderId} status updated to ${newStatus}`);

    } catch (error) {
      console.error('Error updating delivery status:', error);
      alert('Error updating delivery status. Please try again.');
    } finally {
      setUpdatingOrder(null);
      setShowStatusUpdateModal(false);
    }
  };

  // Enhanced cancel order with notifications
  const cancelOrder = async (orderId) => {
    try {
      // Update order in Supabase
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          courier_status: 'cancelled',
          courier_id: null,
          cancelled_at: new Date().toISOString()
        })
        .eq('id', orderId);

      if (error) throw error;

      // Record in order status history
      await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          status: 'cancelled',
          courier_status: 'cancelled',
          notes: 'Order cancelled by courier'
        });

      // Send notification to customer
      try {
        const order = currentBookingsState.find(o => o.id === orderId);
        if (order && order.supabaseData) {
          await notificationService.notifyOrderStatusUpdate(
            orderId,
            'cancelled',
            order.supabaseData.customers?.email,
            {
              courier_name: userData.name,
              order_number: order.orderNumber,
              reason: 'Cancelled by courier'
            }
          );
        }
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
      }

      console.log(`Order ${orderId} cancelled`);

    } catch (error) {
      console.error('Error cancelling order:', error);
      alert('Error cancelling order. Please try again.');
    } finally {
      setShowCancelConfirmModal(false);
      setOrderToCancel(null);
    }
  };

  // Timer effect for cancellation
  useEffect(() => {
    let interval;
    if (isCancellingWithTimer && cancellationTimer > 0) {
      interval = setInterval(() => {
        setCancellationTimer((prev) => prev - 1);
      }, 1000);
    } else if (isCancellingWithTimer && cancellationTimer === 0) {
      // Timer finished, execute cancellation
      if (orderToCancel) {
        cancelOrder(orderToCancel.id);
      }
      setIsCancellingWithTimer(false);
      setCancellationTimer(null);
    }
    return () => clearInterval(interval);
  }, [isCancellingWithTimer, cancellationTimer, orderToCancel]);

  const startCancellationTimer = () => {
    setIsCancellingWithTimer(true);
    setCancellationTimer(10); // 10 seconds countdown
  };

  const stopCancellationTimer = () => {
    setIsCancellingWithTimer(false);
    setCancellationTimer(null);
  };

  // FIXED: Enhanced load remarks for orders (FROM courier TO customer)
  const loadRemarks = async () => {
    try {
      if (!userData?.id) {
        console.log('User ID not available');
        return;
      }

      console.log('Loading remarks for courier:', userData.id);

      const { data, error } = await supabase
        .from('order_remarks')
        .select('order_id, remark, created_at')
        .eq('created_by', userData.id)
        .eq('recipient_user_type', 'customer')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Remarks data received:', data);

      const remarksMap = {};
      (data || []).forEach(item => {
        remarksMap[item.order_id] = item.remark;
      });

      console.log('Processed remarks:', remarksMap);
      setRemarks(remarksMap);
    } catch (error) {
      console.error('Error loading remarks:', error);
    }
  };

  // Enhanced save remarks with notifications
  const saveRemark = async () => {
    try {
      if (selectedOrderId && currentOrderRemark.trim()) {
        // Check if remark already exists - if so, update it; otherwise insert new
        if (remarks[selectedOrderId]) {
          // Update existing remark
          const { data, error } = await supabase
            .from('order_remarks')
            .update({
              remark: currentOrderRemark,
              updated_at: new Date().toISOString()
            })
            .eq('order_id', selectedOrderId)
            .eq('created_by', userData.id)
            .eq('recipient_user_type', 'customer')
            .select()
            .single();

          if (error) throw error;
        } else {
          // Insert new remark
          const { data, error } = await supabase
            .from('order_remarks')
            .insert({
              order_id: selectedOrderId,
              remark: currentOrderRemark,
              created_by: userData.id,
              recipient_user_type: 'customer',
              remark_type: 'feedback',
              created_at: new Date().toISOString()
            })
            .select()
            .single();

          if (error) throw error;
        }

        // Update local state
        setRemarks(prev => ({
          ...prev,
          [selectedOrderId]: currentOrderRemark
        }));

        // Send courier feedback notification to customer
        try {
          const order = [...currentBookingsState, ...completedBookingsState].find(o => o.id === selectedOrderId);
          if (order && order.supabaseData) {
            await notificationService.notifyCourierFeedback(
              selectedOrderId,
              userData.name,
              currentOrderRemark,
              order.supabaseData.customer_id
            );
          }
        } catch (notificationError) {
          console.error('Error sending notification:', notificationError);
        }

        setShowRemarksModal(false);
        setCurrentOrderRemark('');
        setSelectedOrderId(null);
        setSelectedOrderForRemarks(null);

        alert(remarks[selectedOrderId]
          ? 'Feedback updated successfully! The customer has been notified.'
          : 'Thank you for your feedback! The customer has been notified.'
        );
      } else {
        alert('Please enter your feedback before submitting.');
      }
    } catch (err) {
      console.error('Error saving remark:', err);
      alert('Error saving feedback. Please try again.');
    }
  };

  // Calculate fare breakdown based on actual fare calculation
  const calculateFareBreakdown = (order) => {
    if (!order) return [];

    // If we have stored fare breakdown, use it
    if (order.fare_breakdown) {
      const breakdown = [];

      if (order.fare_breakdown.baseFare > 0) {
        breakdown.push({
          description: 'Base Fare',
          amount: order.fare_breakdown.baseFare,
          icon: <DollarSign size={16} />
        });
      }

      if (order.fare_breakdown.distanceCost > 0) {
        breakdown.push({
          description: `Distance (${order.distance || '0 km'})`,
          amount: order.fare_breakdown.distanceCost,
          icon: <MapPin size={16} />
        });
      }

      if (order.fare_breakdown.timeCost > 0) {
        breakdown.push({
          description: `Time (${order.estimatedTime || '0 mins'})`,
          amount: order.fare_breakdown.timeCost,
          icon: <Clock size={16} />
        });
      }

      if (order.fare_breakdown.rushBonus > 0) {
        breakdown.push({
          description: 'Rush Delivery Bonus',
          amount: order.fare_breakdown.rushBonus,
          icon: <Zap size={16} />
        });
      }

      if (order.fare_breakdown.platformFee > 0) {
        breakdown.push({
          description: 'Platform Service Fee',
          amount: order.fare_breakdown.platformFee,
          icon: <Percent size={16} />
        });
      }

      return breakdown;
    }

    // Fallback to basic calculation if no stored breakdown
    const baseFare = 40.00;
    const distanceRate = parseFloat(order.distance || 5) * 8.00;
    const serviceFee = 30.00;
    const itemsTotal = order.items?.reduce((sum, item) => sum + (item.price * item.quantity), 0) || 0;

    const breakdown = [
      { description: 'Base Fare', amount: baseFare, icon: <DollarSign size={16} /> },
      { description: `Distance (${order.distance || '5 km'})`, amount: distanceRate, icon: <MapPin size={16} /> },
      { description: 'Service Fee', amount: serviceFee, icon: <Percent size={16} /> },
      { description: 'Items Total', amount: itemsTotal, icon: <Package size={16} /> },
    ];

    if (order.isRushDelivery && order.rushAmount) {
      breakdown.push({
        description: 'Rush Delivery',
        amount: parseFloat(order.rushAmount),
        icon: <Zap size={16} />
      });
    }

    return breakdown;
  };

  // Filtering logic
  const getFilteredOrders = (orders) => {
    return orders.filter(order => {
      const matchesSearch =
        order.pickupLocation?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.deliveryLocation?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.item?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesService =
        activeService === 'All' || order.serviceType === activeService;

      const matchesStatus =
        activeStatus === 'All' || order.status === activeStatus;

      const matchesCategory =
        activeCategory === 'All' || order.category === activeCategory;

      return matchesSearch && matchesService && matchesStatus && matchesCategory;
    });
  };

  const filteredCurrentBookings = getFilteredOrders(currentBookingsState);
  const filteredCompletedBookings = getFilteredOrders(completedBookingsState);
  const displayOrders = activeTab === 'current' ? filteredCurrentBookings : filteredCompletedBookings;

  // Modal functions
  const openRemarksModal = (order, existingRemark = '') => {
    setSelectedOrderId(order.id);
    setSelectedOrderForRemarks(order);
    setCurrentOrderRemark(existingRemark || '');
    setShowRemarksModal(true);
  };

  const openOrderDetails = (order) => {
    setSelectedOrder(order);
    setShowOrderDetailsModal(true);
  };

  const openStatusUpdateModal = (order) => {
    setSelectedOrder(order);
    setShowStatusUpdateModal(true);
  };

  const openPaymentBreakdown = (order) => {
    setSelectedOrder(order);
    setShowPaymentBreakdownModal(true);
  };

  const confirmCancelOrder = (order) => {
    setOrderToCancel(order);
    setShowCancelConfirmModal(true);
  };

  // Helper functions
  const getNextStatusOptions = (order) => {
    const statusFlow = {
      'accepted': ['picked_up'],
      'picked_up': ['on_the_way'],
      'on_the_way': ['arrived'],
      'arrived': ['delivered']
    };

    const currentStatus = order.deliveryStatus || order.status;
    return statusFlow[currentStatus] || [];
  };

  const getStatusDisplay = (deliveryStatus) => {
    const statusMap = {
      'pending': 'Pending Acceptance',
      'accepted': 'Accepted - Ready for Pickup',
      'picked_up': 'Picked Up',
      'on_the_way': 'On The Way',
      'arrived': 'Arrived at Destination',
      'delivered': 'Delivered',
      'completed': 'Completed',
      'cancelled': 'Cancelled'
    };
    return statusMap[deliveryStatus] || deliveryStatus;
  };

  // Render star rating (for consistency with CourierHistory)
  const renderStarRating = (rating) => {
    return (
      <div className="star-rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={16}
            className={star <= rating ? 'star-filled' : 'star-empty'}
            fill={star <= rating ? 'currentColor' : 'none'}
          />
        ))}
        <span className="rating-text">({rating}/5)</span>
      </div>
    );
  };

  // Timeline rendering function
  const renderTimeline = (order) => {
    const statusOrder = ['accepted', 'picked_up', 'on_the_way', 'arrived', 'delivered'];
    const currentStatusIndex = statusOrder.indexOf(order.deliveryStatus);

    return (
      <div className="delivery-timeline">
        {statusOrder.map((status, index) => {
          const isCompleted = index <= currentStatusIndex;
          const isCurrent = index === currentStatusIndex;

          return (
            <div key={status} className={`timeline-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
              <div className="timeline-marker">
                {isCompleted ? <CheckCircle size={16} /> : <div className="pending-marker" />}
              </div>
              <div className="timeline-content">
                <span className="timeline-status">{getStatusDisplay(status)}</span>
              </div>
              {index < statusOrder.length - 1 && (
                <div className={`timeline-connector ${isCompleted ? 'completed' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Download receipt function
  const downloadReceipt = async (order) => {
    try {
      const downloadButton = document.querySelector('.download-receipt-button-total');
      if (downloadButton) {
        downloadButton.innerHTML = '<span>Generating PDF...</span>';
        downloadButton.disabled = true;
      }

      const receiptDiv = document.createElement('div');
      receiptDiv.style.position = 'fixed';
      receiptDiv.style.left = '-9999px';
      receiptDiv.style.top = '0';
      receiptDiv.style.width = '210mm';
      receiptDiv.style.minHeight = '297mm';
      receiptDiv.style.padding = '20mm';
      receiptDiv.style.backgroundColor = 'white';
      receiptDiv.style.color = 'black';
      receiptDiv.style.fontFamily = 'Arial, sans-serif';
      receiptDiv.style.zIndex = '9999';

      receiptDiv.innerHTML = generateReceiptHTML(order);
      document.body.appendChild(receiptDiv);

      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(receiptDiv, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        allowTaint: true,
        removeContainer: true
      });

      document.body.removeChild(receiptDiv);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      const imgData = canvas.toDataURL('image/png', 1.0);
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);

      pdf.save(`Pickarry-Receipt-${order.orderNumber}.pdf`);

      if (downloadButton) {
        downloadButton.innerHTML = '<Download size={18} /><span>Download</span>';
        downloadButton.disabled = false;
      }

    } catch (error) {
      console.error('Error generating PDF receipt:', error);
      const downloadButton = document.querySelector('.download-receipt-button-total');
      if (downloadButton) {
        downloadButton.innerHTML = '<Download size={18} /><span>Download</span>';
        downloadButton.disabled = false;
      }

      try {
        const textReceipt = generateTextReceipt(order);
        downloadTextReceipt(textReceipt, order.orderNumber);
        alert('PDF generation failed. A text receipt has been downloaded instead.');
      } catch (fallbackError) {
        console.error('Fallback receipt generation failed:', fallbackError);
        alert('Error generating receipt. Please try again.');
      }
    }
  };

  const generateReceiptHTML = (order) => {
    const breakdown = calculateFareBreakdown(order);

    return `
      <div class="receipt-content" style="width: 100%; height: 100%;">
        <!-- Company Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px;">
          <div style="text-align: left;">
            <img src="${logo}" alt="Pickarry Logo" style="width: 60px; height: auto; margin-bottom: 10px;" />
            <h2 style="margin: 0; color: #000; font-size: 24px; font-weight: bold;">Pickarry Delivery</h2>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Dynamic Fare Receipt</p>
          </div>
          <div style="text-align: right; font-size: 12px;">
            <p style="margin: 2px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            <p style="margin: 2px 0;"><strong>Time:</strong> ${new Date().toLocaleTimeString()}</p>
            <p style="margin: 2px 0;"><strong>Receipt ID:</strong> ${order.orderNumber}</p>
          </div>
        </div>

        <!-- Order Information -->
        <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #ddd;">
          <h4 style="margin: 0 0 15px 0; color: #000; font-size: 16px; font-weight: bold;">Order Information</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Customer:</span>
              <span style="color: #000; text-align: right;">${order.customerName}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Service Type:</span>
              <span style="color: #000; text-align: right;">${order.serviceType}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Vehicle Type:</span>
              <span style="color: #000; text-align: right;">${order.vehicleType}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Pickup:</span>
              <span style="color: #000; text-align: right;">${order.pickupLocation}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Delivery:</span>
              <span style="color: #000; text-align: right;">${order.deliveryLocation}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Distance:</span>
              <span style="color: #000; text-align: right;">${order.distance}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Courier:</span>
              <span style="color: #000; text-align: right;">${userData?.name || 'Courier'}</span>
            </div>
          </div>
        </div>

        <!-- Payment Breakdown -->
        <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #ddd;">
          <h4 style="margin: 0 0 15px 0; color: #000; font-size: 16px; font-weight: bold;">Fare Breakdown</h4>
          <div>
            ${breakdown.map(item => `
              <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                <span style="color: #333; font-size: 14px;">${item.description}</span>
                <span style="color: #000; font-size: 14px; font-weight: 500;">₱${item.amount.toFixed(2)}</span>
              </div>
            `).join('')}
            <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #000; margin-top: 10px; font-weight: bold; font-size: 16px;">
              <span style="color: #000;">Total Amount</span>
              <span style="color: #000;">₱${order.payment}</span>
            </div>
          </div>
        </div>

        <!-- Payment Method -->
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 15px 0; color: #000; font-size: 16px; font-weight: bold;">Payment Information</h4>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 4px; font-size: 14px;">
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Payment Method:</span>
              <span style="color: #000;">${order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'GCash'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 5px 0;">
              <span style="font-weight: bold; color: #333;">Status:</span>
              <span style="color: #000;">${order.status}</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding-top: 20px; border-top: 2px solid #000; margin-top: 20px; color: #666; font-size: 12px;">
          <p style="margin: 5px 0; font-style: italic;">Thank you for choosing Pickarry!</p>
          <p style="margin: 5px 0;">For inquiries: THE-PICKARRY@GMAIL.COM</p>
          <p style="margin: 5px 0; font-size: 10px;">Generated on: ${new Date().toLocaleString()}</p>
        </div>
      </div>
    `;
  };

  const generateTextReceipt = (order) => {
    const breakdown = calculateFareBreakdown(order);

    return `
PICKARRY DELIVERY RECEIPT
==============================

Order Number: ${order.orderNumber}
Date: ${new Date().toLocaleDateString()}
Time: ${new Date().toLocaleTimeString()}

CUSTOMER INFORMATION:
-------------------
Name: ${order.customerName}
Service: ${order.serviceType}
Vehicle: ${order.vehicleType}

LOCATIONS:
---------
Pickup: ${order.pickupLocation}
Delivery: ${order.deliveryLocation}
Distance: ${order.distance}

FARE BREAKDOWN:
--------------
${breakdown.map(item =>
      `${item.description}: ₱${item.amount.toFixed(2)}`
    ).join('\n')}

TOTAL AMOUNT: ₱${order.payment}

PAYMENT INFORMATION:
------------------
Method: ${order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'GCash'}
Status: ${order.status}

Thank you for choosing Pickarry!
For inquiries: THE-PICKARRY@GMAIL.COM
==============================
Generated on: ${new Date().toLocaleString()}
  `.trim();
  };

  const downloadTextReceipt = (content, orderNumber) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Pickarry-Receipt-${orderNumber}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleLogout = () => {
    clearUserSession();
    navigate('/');
  };

  if (loading || fareLoading) {
    return (
      <div className="courier-home">
        <div className="loading-container">
          <Loader2 className="animate-spin text-gray-500" size={32} />
          <p>Loading courier dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="courier-home">
      {/* Header */}
      <div className="courier-headers">
        <div className="header-logo">
          <img src={logo} alt="Pickarry Logo" className="w-19 h-12" />
        </div>
        <div className="header-right">
          <NotificationDropdown userType="courier" />
          <div className="courier-profile">
            <div className="profile-avatar">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="Profile"
                  className="profile-avatar-image"
                />
              ) : (
                <span>{userData?.initials || 'C'}</span>
              )}
            </div>
          </div>
          <button onClick={handleLogout} className="logout-button">
            Log Out
          </button>
        </div>
      </div>

      <div className="courier-content">
        {/* Sidebar */}
        <div className="courier-sidebar">
          <div className="courier-profile-card">
            <div className="profile-avatar-large">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="Profile"
                  className="profile-avatar-image-large"
                />
              ) : (
                <span>{userData?.initials || 'C'}</span>
              )}
            </div>
            <div className="profile-info">
              <h3>{userData?.name || 'Courier'}</h3>
              <p>{userData?.email || 'courier@gmail.com'}</p>
              {/* <p className="vehicle-info">Vehicle: {userData?.vehicle || 'Not set'}</p> */}
            </div>
          </div>

          <nav className="courier-nav">
            <button onClick={() => navigate('/courier/home')} className="nav-item">
              <Home />
              <span>Home</span>
            </button>
            <button onClick={() => navigate('/courier/history')} className="nav-item">
              <FileText />
              <span>Delivery</span>
            </button>
            <button onClick={() => navigate('/courier/book')} className="nav-item active">
              <Calendar />
              <span>Book</span>
            </button>
            <button onClick={() => navigate('/courier/menu')} className="nav-item">
              <Menu />
              <span>Menu</span>
            </button>
          </nav>
        </div>

        {/* Main Content */}
        <div className="courier-main-contents">
          {/* Tabs */}
          <div className="courier-tabs">
            <button
              className={`tab-btn ${activeTab === 'current' ? 'active' : ''}`}
              onClick={() => setActiveTab('current')}
            >
              Current Book
            </button>
            <button
              className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Book History
            </button>
          </div>

          {/* Filter Buttons */}
          <div className="filter-buttons">
            <button
              className={`filter-btn ${activeService === 'All' ? 'active' : ''}`}
              onClick={() => setActiveService('All')}
            >
              All
            </button>
            <button
              className={`filter-btn ${activeService === 'Pasundo' ? 'active' : ''}`}
              onClick={() => setActiveService('Pasundo')}
            >
              Pasundo
            </button>
            <button
              className={`filter-btn ${activeService === 'Pasugo' ? 'active' : ''}`}
              onClick={() => setActiveService('Pasugo')}
            >
              Pasugo
            </button>
          </div>

          {/* Search Bar */}
          <div className="courier-search-bar">
            <div className="search-input-container">
              <Search className="search-icon" size={20} />
              <input
                type="text"
                placeholder="Search orders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>

            {/* Category and Filter Dropdowns */}
            <div className="orders-toolbar-right">
              {/* Category Dropdown */}
              <div className="dropdown">
                <button className="dropdown-button" onClick={() => {
                  setShowCategoryDropdown(!showCategoryDropdown);
                  setShowFilterDropdown(false);
                }}>
                  {activeCategory} <ChevronDown className="w-4 h-4" />
                </button>
                {showCategoryDropdown && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item" onClick={() => {
                      setActiveCategory('All');
                      setShowCategoryDropdown(false);
                    }}>All</div>
                    <div className="dropdown-item" onClick={() => {
                      setActiveCategory('Food');
                      setShowCategoryDropdown(false);
                    }}>Food</div>
                    <div className="dropdown-item" onClick={() => {
                      setActiveCategory('Documents');
                      setShowCategoryDropdown(false);
                    }}>Documents</div>
                    <div className="dropdown-item" onClick={() => {
                      setActiveCategory('Package');
                      setShowCategoryDropdown(false);
                    }}>Package</div>
                  </div>
                )}
              </div>

              {/* Status Filter Dropdown */}
              <div className="dropdown">
                <button className="dropdown-button" onClick={() => {
                  setShowFilterDropdown(!showFilterDropdown);
                  setShowCategoryDropdown(false);
                }}>
                  {activeStatus} <ChevronDown className="w-4 h-4" />
                </button>
                {showFilterDropdown && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item" onClick={() => {
                      setActiveStatus('All');
                      setShowFilterDropdown(false);
                    }}>All</div>
                    <div className="dropdown-item" onClick={() => {
                      setActiveStatus('Accepted');
                      setShowFilterDropdown(false);
                    }}>Accepted</div>
                    <div className="dropdown-item" onClick={() => {
                      setActiveStatus('In Progress');
                      setShowFilterDropdown(false);
                    }}>In Progress</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Orders List */}
          <div className="courier-orders-list">
            {displayOrders.length === 0 ? (
              <div className="no-orders-container">
                <Package size={48} className="no-orders-icon" />
                <h3 className="no-orders-title">
                  {activeTab === 'current' ? 'No Active Bookings' : 'No Book History'}
                </h3>
                <p className="no-orders-text">
                  {activeTab === 'current'
                    ? 'There are currently no active bookings. New bookings will appear here for acceptance.'
                    : 'Completed and cancelled bookings will appear here.'}
                </p>
              </div>
            ) : (
              displayOrders.map((order) => (
                <div key={order.id} className="courier-order-card">
                  {/* Order Header */}
                  <div className="order-header">
                    <div className="order-pickup">
                      <MapPin className="w-5 h-5" />
                      <span>{order.pickupLocation}</span>
                    </div>
                    {activeTab === 'history' && (
                      <div className="order-actions">
                        <button className="action-button favorite"><Heart className="w-5 h-5" /></button>
                        <button className="action-button delete"><Trash2 className="w-5 h-5" /></button>
                      </div>
                    )}
                  </div>

                  {/* Order Details */}
                  <div className="order-details">
                    <div className="order-detail">
                      <MapPin className="detail-icon w-4 h-4" />
                      <span>{order.deliveryLocation}</span>
                      <span className="detail-right detail-right-service service-type">{order.serviceType}</span>
                    </div>
                    <div className="order-detail">
                      <Package className="detail-icon w-4 h-4" />
                      <span>{order.item}</span>
                      <span className="detail-right detail-right-time">
                        {order.date}
                      </span>
                    </div>
                    <div className="order-detail">
                      <Truck className="detail-icon w-4 h-4" />
                      <span>{order.vehicleType}</span>
                      <span className="detail-right detail-right-payment">
                        {order.paymentMethod === 'GCash' ? 'GCash' : 'COD'}: ₱{order.payment}
                      </span>
                    </div>
                    <div className="order-detail">
                      <Clock className="detail-icon w-4 h-4" />
                      <span>Delivery Status: {getStatusDisplay(order.deliveryStatus)}</span>
                      <span className={`detail-right detail-right-status status-text status-${order.status.toLowerCase().replace(' ', '-')}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>

                  {/* Order Footer */}
                  <div className="order-footer">
                    <button
                      className="order-view-button"
                      onClick={() => openOrderDetails(order)}
                    >
                      View Details
                    </button>

                    {activeTab === 'current' && (
                      <>
                        {/* Show Update Status button for orders that can be updated */}
                        {getNextStatusOptions(order).length > 0 ? (
                          <div className="current-order-actions">
                            <button
                              className="action-button update-status"
                              onClick={() => openStatusUpdateModal(order)}
                              disabled={updatingOrder === order.id}
                            >
                              {updatingOrder === order.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <PlayCircle size={16} />
                              )}
                              {updatingOrder === order.id ? 'Updating...' : 'Update Status'}
                            </button>
                          </div>
                        ) : (
                          // Show Cancel button only for orders that can't be updated further
                          order.deliveryStatus !== 'delivered' && order.deliveryStatus !== 'cancelled' && (
                            <div className="current-order-actions">
                              <button
                                className="action-button cancel-timer"
                                onClick={() => confirmCancelOrder(order)}
                              >
                                <X size={16} />
                                Cancel Book
                              </button>
                            </div>
                          )
                        )}
                      </>
                    )}

                    {activeTab === 'history' && (
                      <div className="history-order-actions">
                        {/* <div className="order-earnings">
                          <span className="earnings-label">Earnings:</span>
                          <span className="earnings-value">{order.earnings}</span>
                        </div> */}
                        <button
                          className={`remarks-button ${remarks[order.id] ? 'has-remarks' : ''}`}
                          onClick={() => openRemarksModal(order, remarks[order.id])}
                        >
                          <MessageSquare size={16} />
                          <span>{remarks[order.id] ? 'View/Edit Feedback' : 'Add Feedback'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ORDER DETAILS MODAL */}
      {showOrderDetailsModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowOrderDetailsModal(false)}>
          <div className="order-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button className="close-button" onClick={() => setShowOrderDetailsModal(false)}>
                <X size={24} />
              </button>
              <h2>Order Details</h2>
            </div>

            <div className="modal-body order-details-body">
              {/* Order Images */}
              <div className="order-images-section">
                <h3>Order Items</h3>
                <div className="order-images-grid">
                  {selectedOrder.images && selectedOrder.images.length > 0 ? (
                    selectedOrder.images.map((image, index) => (
                      <div key={index} className="order-image-item">
                        <div className="order-image-placeholder">
                          {image ? (
                            <img
                              src={image}
                              alt={`Item ${index + 1}`}
                              className="order-image"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.nextSibling.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div className="image-placeholder-fallback" style={{ display: image ? 'none' : 'flex' }}>
                            <Package className="image-placeholder-icon" size={32} />
                            <span className="image-label">Item {index + 1}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    // Show default placeholders when no images
                    Array.from({ length: 3 }).map((_, index) => (
                      <div key={`empty-${index}`} className="order-image-item">
                        <div className="order-image-placeholder empty">
                          <Package className="image-placeholder-icon" size={32} />
                          <span className="image-label">Item {index + 1}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Order Information */}
              <div className="order-info-section">
                <h3>Order Information</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Order Number</span>
                    <p className="info-value">{selectedOrder.orderNumber}</p>
                  </div>
                  <div className="info-item">
                    <Calendar className="info-icon" />
                    <div>
                      <label>Order Date & Time</label>
                      <p>{selectedOrder.date}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <MapPin className="info-icon" />
                    <div>
                      <label>Pickup Location</label>
                      <p>{selectedOrder.pickupLocation}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <Navigation className="info-icon" />
                    <div>
                      <label>Delivery Location</label>
                      <p>{selectedOrder.deliveryLocation}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <Truck className="info-icon" />
                    <div>
                      <label>Vehicle Type</label>
                      <p>{selectedOrder.vehicleType}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <Clock className="info-icon" />
                    <div>
                      <label>Estimated Time</label>
                      <p>{selectedOrder.estimatedTime}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <MapPin className="info-icon" />
                    <div>
                      <label>Distance</label>
                      <p>{selectedOrder.distance}</p>
                    </div>
                  </div>
                  <div className="info-item full-width">
                    <Package className="info-icon" />
                    <div>
                      <label>Category</label>
                      <p>{selectedOrder.category}</p>
                    </div>
                  </div>
                  <div className="info-item full-width">
                    <FileText className="info-icon" />
                    <div>
                      <label>Description</label>
                      <p>{selectedOrder.description}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Service Information */}
              <div className="service-info-section">
                <h3>Service Information</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <Truck className="info-icon" />
                    <div>
                      <label>Service Type</label>
                      <p className="service-type">{selectedOrder.serviceType}</p>
                    </div>
                  </div>
                  {activeTab === 'history' && selectedOrder.earnings && (
                    <div className="info-item">
                      <span className="peso-sign">₱</span>
                      <div>
                        <label>Your Earnings</label>
                        <p className="earnings">{selectedOrder.earnings}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Information */}
              <div className="customer-info-section">
                <h3>Customer Information</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <User className="info-icon" />
                    <div>
                      <label>Name</label>
                      <p>{selectedOrder.customerName}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <Phone className="info-icon" />
                    <div>
                      <label>Phone</label>
                      <p>{selectedOrder.phone}</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <Mail className="info-icon" />
                    <div>
                      <label>Email</label>
                      <p>{selectedOrder.email}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Information */}
              <div className="payment-info-section">
                <h3>Payment Information</h3>
                <div className="payment-summary">
                  <div className="payment-method">
                    {selectedOrder.paymentMethod === 'GCash' ? (
                      <Smartphone className="info-icon" />
                    ) : (
                      <CreditCard className="info-icon" />
                    )}
                    <div>
                      <label>Payment Method</label>
                      <p>{selectedOrder.paymentMethod}</p>
                    </div>
                  </div>
                  <div className="total-amount">
                    <div>
                      <label>Total Amount</label>
                      <p className="amount">₱{selectedOrder.payment}</p>
                    </div>
                    <button
                      className="breakdown-button"
                      onClick={() => {
                        setShowOrderDetailsModal(false);
                        openPaymentBreakdown(selectedOrder);
                      }}
                    >
                      Breakdown
                    </button>
                  </div>
                </div>
              </div>

              {/* Order Status */}
              <div className="status-section">
                <h3>Order Status</h3>
                <div className="delivery-status-info">
                  <div className={`status-badge status-${selectedOrder.status.toLowerCase().replace(' ', '-')}`}>
                    {selectedOrder.status}
                  </div>
                  <p className="delivery-status-detail">
                    Current Delivery Status: <strong>{getStatusDisplay(selectedOrder.deliveryStatus)}</strong>
                  </p>
                </div>
              </div>

              {/* FIXED: Enhanced Customer Feedback Section */}
              {customerFeedback[selectedOrder.id] && (
                <div className="feedback-section">
                  <h3>Customer Feedback</h3>
                  <div className="feedback-card">
                    <div className="feedback-header">
                      <User className="feedback-icon" size={16} />
                      <span className="feedback-source">From Customer</span>
                      {customerFeedback[selectedOrder.id].date && (
                        <span className="feedback-date">
                          {new Date(customerFeedback[selectedOrder.id].date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <p className="feedback-text">{customerFeedback[selectedOrder.id].remark}</p>
                  </div>
                </div>
              )}

              {/* Enhanced Action Buttons */}
              <div className="modal-actions">
                <button
                  className="cancel-button secondary"
                  onClick={() => setShowOrderDetailsModal(false)}
                >
                  Close
                </button>

                {activeTab === 'current' && (
                  <>
                    {getNextStatusOptions(selectedOrder).length > 0 && (
                      <button
                        className="action-button update-status"
                        onClick={() => {
                          setShowOrderDetailsModal(false);
                          openStatusUpdateModal(selectedOrder);
                        }}
                      >
                        Update Status
                      </button>
                    )}

                    {selectedOrder.deliveryStatus !== 'delivered' &&
                      selectedOrder.deliveryStatus !== 'cancelled' && (
                        <button
                          className="action-button cancel-timer"
                          style={{ marginLeft: '10px', backgroundColor: '#e74c3c' }}
                          onClick={() => {
                            setShowOrderDetailsModal(false);
                            confirmCancelOrder(selectedOrder);
                          }}
                        >
                          Cancel Book
                        </button>
                      )}
                  </>
                )}

                {activeTab === 'history' && (
                  <button
                    className={`remarks-button ${remarks[selectedOrder.id] ? 'has-remarks' : ''}`}
                    onClick={() => {
                      setShowOrderDetailsModal(false);
                      openRemarksModal(selectedOrder, remarks[selectedOrder.id]);
                    }}
                  >
                    <MessageSquare size={16} />
                    <span>{remarks[selectedOrder.id] ? 'View/Edit Feedback' : 'Add Feedback'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STATUS UPDATE MODAL */}
      {showStatusUpdateModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowStatusUpdateModal(false)}>
          <div className="status-update-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button className="close-button" onClick={() => setShowStatusUpdateModal(false)}>
                <X size={24} />
              </button>
              <h2>Update Delivery Status</h2>
            </div>

            <div className="modal-body">
              <div className="order-info">
                <p className="order-id">Order: {selectedOrder.orderNumber}</p>
                <p className="customer-info">Customer: {selectedOrder.customerName}</p>
              </div>

              {/* Delivery Timeline */}
              <div className="timeline-section">
                <h3>Delivery Progress</h3>
                {renderTimeline(selectedOrder)}
              </div>

              <div className="status-update-section">
                <h3>Update Status</h3>

                <div className="status-options">
                  {getNextStatusOptions(selectedOrder).map((status) => (
                    <button
                      key={status}
                      className={`status-option-btn status-${status}`}
                      onClick={() => updateDeliveryStatus(selectedOrder.id, status)}
                      disabled={updatingOrder === selectedOrder.id}
                    >
                      <div className="status-icon">
                        {status === 'picked_up' && <Package size={20} />}
                        {status === 'on_the_way' && <TruckIcon size={20} />}
                        {status === 'arrived' && <MapPin size={20} />}
                        {status === 'delivered' && <CheckCircle size={20} />}
                      </div>
                      <div className="status-info">
                        <span className="status-title">{getStatusDisplay(status)}</span>
                        <span className="status-description">
                          {status === 'picked_up' && 'Mark package as picked up from location'}
                          {status === 'on_the_way' && 'Start delivery to customer location'}
                          {status === 'arrived' && 'Notify customer of arrival'}
                          {status === 'delivered' && 'Complete the delivery and move to history'}
                        </span>
                      </div>
                      {updatingOrder === selectedOrder.id && (
                        <Loader2 size={16} className="animate-spin" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="notification-note">
                  <Bell size={16} />
                  <span>Customer will be notified automatically when you update the status.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENT BREAKDOWN MODAL - UPDATED WITH DYNAMIC FARE MANAGEMENT */}
      {showPaymentBreakdownModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowPaymentBreakdownModal(false)}>
          <div className="payment-breakdown-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button className="close-button" onClick={() => setShowPaymentBreakdownModal(false)}>
                <X size={24} />
              </button>
              <h2>Payment Breakdown</h2>
            </div>

            <div className="modal-body">
              <div className="breakdown-header">
                <h3 className="order-number">Order #{selectedOrder.orderNumber}</h3>
                <p className="breakdown-subtitle">Dynamic Fare Computation</p>
              </div>

              {/* Payment Breakdown Items */}
              <div className="breakdown-items">
                {calculateFareBreakdown(selectedOrder).map((item, index) => (
                  <div key={index} className="breakdown-item">
                    <div className="breakdown-item-header">
                      {item.icon}
                      <span className="breakdown-description">{item.description}</span>
                    </div>
                    <span className="breakdown-amount">₱{item.amount.toFixed(2)}</span>
                  </div>
                ))}

                {/* Rush Delivery Notice */}
                {selectedOrder.isRushDelivery && selectedOrder.rushAmount > 0 && (
                  <div className="rush-delivery-notice">
                    <Zap size={16} className="rush-icon" />
                    <span>Rush Delivery Service Applied</span>
                  </div>
                )}

                {/* Total Amount with Download Button */}
                <div className="breakdown-total-container">
                  <div className="breakdown-total">
                    <span className="total-label">Total Amount</span>
                    <span className="total-amount">₱{selectedOrder.payment}</span>
                  </div>
                  <button
                    className="download-receipt-button-total"
                    onClick={() => downloadReceipt(selectedOrder)}
                    title="Download Receipt"
                  >
                    <Download size={18} />
                    <span>Download</span>
                  </button>
                </div>
              </div>

              {/* Fare Explanation */}
              <div className="fare-explanation">
                <h4>Fare Computation Explained:</h4>
                <ul className="explanation-list">
                  <li><strong>Base Fare:</strong> Fixed starting fee based on vehicle type</li>
                  <li><strong>Distance Rate:</strong> Calculated per kilometer based on actual route</li>
                  <li><strong>Time Cost:</strong> Based on estimated delivery time</li>
                  <li><strong>Platform Fee:</strong> Service charge for platform maintenance</li>
                  {selectedOrder.isRushDelivery && (
                    <li><strong>Rush Bonus:</strong> Additional fee for priority service</li>
                  )}
                </ul>
                {fareConfig && (
                  <div className="fare-config-info">
                    <p><strong>Current Rates:</strong></p>
                    <div className="rate-details">
                      <span>Time Rate: ₱{fareConfig.time_rate_per_minute}/min</span>
                      <span>Platform Fee: {fareConfig.platform_commission}%</span>
                      {selectedOrder.isRushDelivery && (
                        <span>Rush Bonus: ₱{fareConfig.bonus_rate}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL CONFIRMATION MODAL WITH COUNTDOWN */}
      {showCancelConfirmModal && orderToCancel && (
        <div className="modal-overlay" onClick={() => !isCancellingWithTimer && setShowCancelConfirmModal(false)}>
          <div className="cancel-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button
                className="close-button"
                onClick={() => {
                  stopCancellationTimer();
                  setShowCancelConfirmModal(false);
                }}
                disabled={isCancellingWithTimer}
              >
                <X size={24} />
              </button>
              <h2>Cancel Booking</h2>
            </div>

            <div className="modal-body">
              <div className="cancel-warning">
                {isCancellingWithTimer ? (
                  <div className="timer-container" style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      border: '5px solid #ff4d4f',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 20px',
                      fontSize: '32px',
                      fontWeight: 'bold',
                      color: '#ff4d4f'
                    }}>
                      {cancellationTimer}
                    </div>
                    <h3>Cancelling in {cancellationTimer} seconds...</h3>
                    <p>Click Undo to keep this booking.</p>
                  </div>
                ) : (
                  <>
                    <AlertTriangle size={48} className="warning-icon" />
                    <h3>Are you sure you want to cancel this booking?</h3>
                    <p className="warning-text">
                      This action cannot be undone. The customer will be notified that you have declined their booking.
                    </p>

                    <div className="order-details-preview">
                      <p><strong>Order:</strong> {orderToCancel.orderNumber}</p>
                      <p><strong>Pickup:</strong> {orderToCancel.pickupLocation}</p>
                      <p><strong>Delivery:</strong> {orderToCancel.deliveryLocation}</p>
                      <p><strong>Amount:</strong> ₱{orderToCancel.payment}</p>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-actions">
                {isCancellingWithTimer ? (
                  <button
                    className="cancel-button secondary"
                    style={{ width: '100%', backgroundColor: '#f0f0f0', color: '#333' }}
                    onClick={stopCancellationTimer}
                  >
                    Undo Cancellation
                  </button>
                ) : (
                  <>
                    <button
                      className="cancel-button secondary"
                      onClick={() => setShowCancelConfirmModal(false)}
                    >
                      Keep Booking
                    </button>
                    <button
                      className="cancel-button confirm"
                      onClick={startCancellationTimer}
                    >
                      Yes, Cancel Booking
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ENHANCED REMARKS MODAL - Matching CourierHistory Structure */}
      {showRemarksModal && selectedOrderForRemarks && (
        <div className="modal-overlay" onClick={() => setShowRemarksModal(false)}>
          <div className="remarks-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button className="close-button" onClick={() => setShowRemarksModal(false)}>
                <X size={24} />
              </button>
              <h2>
                {remarks[selectedOrderId] ? 'View/Edit Your Feedback' : 'Add Feedback for Customer'}
              </h2>
            </div>
            <div className="modal-body">
              <div className="order-info">
                <p className="order-id">Order ID: {selectedOrderForRemarks.orderNumber}</p>
                <p className="customer-name">Customer: {selectedOrderForRemarks.customerName}</p>
              </div>

              {/* FIXED: Customer's Feedback Section (FROM customer TO courier) */}
              {customerFeedback[selectedOrderId] ? (
                <div className="customer-feedback-section">
                  <h3>Customer's Feedback to You</h3>
                  <div className="feedback-display">
                    <div className="feedback-header">
                      <User className="feedback-icon" size={16} />
                      <span className="feedback-source">From Customer</span>
                      {customerFeedback[selectedOrderId].date && (
                        <span className="feedback-date">
                          {new Date(customerFeedback[selectedOrderId].date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="feedback-text-container">
                      <p className="feedback-text-full">
                        {customerFeedback[selectedOrderId].remark}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="no-feedback-section">
                  <div className="no-feedback-message">
                    <User className="no-feedback-icon" size={20} />
                    <p>No feedback received from customer yet.</p>
                  </div>
                </div>
              )}

              {/* Courier's Feedback Section (FROM courier TO customer) */}
              <div className="courier-feedback-section">
                <h3>Your Feedback to Customer</h3>
                <p className="feedback-instruction">
                  Share your experience with the customer. Your feedback helps improve service quality and helps customers understand areas for improvement.
                </p>
                <textarea
                  value={currentOrderRemark}
                  onChange={(e) => setCurrentOrderRemark(e.target.value)}
                  placeholder="How was your interaction with the customer? Were they responsive, clear with delivery instructions, and available during the delivery? Any suggestions for improvement or positive feedback about their cooperation?"
                  className="remarks-textarea"
                  rows={6}
                  maxLength={500}
                />
                <p className={`character-count ${currentOrderRemark.length > 450 ? 'warning' : ''} ${currentOrderRemark.length >= 500 ? 'error' : ''}`}>
                  {currentOrderRemark.length} / 500 characters
                </p>
              </div>

              <div className="modal-actions">
                <button
                  className="cancel-button"
                  onClick={() => setShowRemarksModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="save-button"
                  onClick={saveRemark}
                  disabled={!currentOrderRemark.trim()}
                >
                  {remarks[selectedOrderId] ? 'Update Feedback' : 'Submit Feedback'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="courier-footer">
        <div className="footer-logo">
          <img src={logo} alt="Pickarry Logo" className="w-8 h-8" />
        </div>

        <div className="footer-links">
          <a href="#" className="footer-link">Contact Us</a>
          <a href="#" className="footer-link">Terms of Use</a>
          <a href="#" className="footer-link">Terms of Service</a>
          <a href="#" className="footer-link">Privacy Policy</a>
          <a href="#" className="footer-link">Rider's Policy</a>
          <a href="#" className="footer-link">Customer's Policy</a>
        </div>

        <div className="footer-copyright">
          <p>© 2025 Pickarry - All rights reserved</p>
        </div>
      </div>
    </div>
  );
};

export default CourierBook;